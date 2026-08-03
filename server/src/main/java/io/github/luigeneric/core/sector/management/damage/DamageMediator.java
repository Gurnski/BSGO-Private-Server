package io.github.luigeneric.core.sector.management.damage;

import io.github.luigeneric.core.User;
import io.github.luigeneric.core.player.ShipAbility;
import io.github.luigeneric.core.protocols.ProtocolID;
import io.github.luigeneric.core.protocols.ProtocolRegistryWriteOnly;
import io.github.luigeneric.core.protocols.game.GameProtocolWriteOnly;
import io.github.luigeneric.core.protocols.notification.NotificationProtocolWriteOnly;
import io.github.luigeneric.core.sector.SectorCards;
import io.github.luigeneric.core.sector.Tick;
import io.github.luigeneric.core.sector.creation.SectorContext;
import io.github.luigeneric.core.sector.management.ISpaceObjectRemover;
import io.github.luigeneric.core.sector.management.SectorUsers;
import io.github.luigeneric.core.sector.management.lootsystem.claims.LootClaimHolder;
import io.github.luigeneric.core.spaceentities.*;
import io.github.luigeneric.core.spaceentities.statsinfo.stats.SpaceSubscribeInfo;
import io.github.luigeneric.enums.Faction;
import io.github.luigeneric.enums.RemovingCause;
import io.github.luigeneric.enums.SpaceEntityType;
import io.github.luigeneric.linearalgebra.utility.Mathf;
import io.github.luigeneric.templates.cards.CounterCardType;
import io.github.luigeneric.templates.utils.ObjectStat;
import lombok.extern.slf4j.Slf4j;

import java.util.List;
import java.util.Optional;


@Slf4j
public class DamageMediator
{
    private final SectorContext ctx;
    private final DamageCalculator damageCalculator;
    private final LootClaimHolder lootClaimHolder;
    private final ISpaceObjectRemover remover;
    private final SectorDamageHistory sectorDamageHistory;
    private final DamageDurabilityModifier damageDurabilityModifier;
    private final GameProtocolWriteOnly gameProtocolWriteOnly;
    private final SectorCards sectorCards;

    public DamageMediator(final SectorContext ctx,
                          final DamageCalculator damageCalculator,
                          final LootClaimHolder lootClaimHolder,
                          final ISpaceObjectRemover remover,
                          final SectorDamageHistory sectorDamageHistory,
                          final DamageDurabilityModifier damageDurabilityModifier,
                          final GameProtocolWriteOnly gameProtocolWriteOnly
    )
    {
        this.ctx = ctx;
        this.damageCalculator = damageCalculator;
        this.lootClaimHolder = lootClaimHolder;
        this.remover = remover;
        this.sectorDamageHistory = sectorDamageHistory;
        this.damageDurabilityModifier = damageDurabilityModifier;
        this.gameProtocolWriteOnly = gameProtocolWriteOnly;
        this.sectorCards = ctx.blueprint().sectorCards();
    }

    public void dealDamage(final DamageRecord damageRecord)
    {
        final float damage = damageRecord.damage();

        final Optional<RemovingCause> removingCause = damageRecord.to().getRemovingCause();
        removingCause.ifPresent(cause ->
        {
            log.error("in deal damage, object to kill is already removed, objType={}, oldRemovingCause={}",
                    damageRecord.to().getSpaceEntityType(),
                    cause
            );
        });

        final SpaceSubscribeInfo toStats = damageRecord.to().getSpaceSubscribeInfo();
        float damageDealtCleaned = damage;
        boolean wasKillShot = false;

        final float targetHP = toStats.getHp();
        final float newHPDirty = targetHP - damage;
        if (newHPDirty < 0)
        {
            damageDealtCleaned = targetHP;
        }

        toStats.setHp(Mathf.max(newHPDirty, 0f));
        if (damageRecord.energyDrain() > 0f)
            toStats.setPp(Mathf.max(toStats.getPp() - damageRecord.energyDrain(), 0));
        if (toStats.getHp() == 0f)
        {
            final SpaceObject toObject = damageRecord.to();
            if (toObject.getSpaceEntityType() == SpaceEntityType.Outpost)
            {
                //outposts are never destroyed: JumpOut plays the client ftl-out instead of the explosion
                final boolean alreadyRemoved = toObject.isRemoved();
                this.remover.notifyRemovingCauseAdded(toObject, RemovingCause.JumpOut);
                //several projectiles can land in the tick after hull zero; fire the one-shot
                //side effects only for the hit that actually removed the outpost
                if (!alreadyRemoved)
                {
                    //zero+block control here and not in a JumpOut subscriber: the decay despawn
                    //(OutpostSpawnTimer.despawnOp) emits the same cause and must not be blocked,
                    //and without opDied the spawn timer respawns the retreated outpost within 5s
                    ctx.outPostStates().getStateForFaction(toObject.getFaction()).opDied(ctx.tick());
                    sendOutpostRetreatBroadcast(toObject.getFaction());
                }
            }
            else if (toObject.getSpaceEntityType() == SpaceEntityType.Missile && damageRecord.from() != null)
            {
                /* A shot-down missile leaves with Hit, not Death. The client's ObjectLeft handler
                 * plays MissileScript.Terminate's explosion only on Hit - on Death a missile has
                 * no removal effect and silently pops out of existence (SpaceObject.OnDestroyed is
                 * an empty virtual that Missile does not override). Death is also the cause that
                 * arms the loot/claim machinery, which a missile must never enter. The killer is
                 * the hit object; ObjectLeftHit dereferences it, hence the null guard above. */
                this.remover.notifyRemovingCauseAdded(toObject, RemovingCause.Hit, damageRecord.from());
            }
            else
            {
                this.remover.notifyRemovingCauseAdded(toObject, RemovingCause.Death, damageRecord.from());
            }
            toStats.setPp(0);
            wasKillShot = true;
        }

        final DamageRecord newDmgRecord = DamageRecord.fromCleaned(damageRecord, damageDealtCleaned, wasKillShot);
        this.sectorDamageHistory.damageUpdate(newDmgRecord);
        this.damageDurabilityModifier.damageReceived(newDmgRecord);
        sendDealDamageTo(newDmgRecord);
    }

    private void sendOutpostRetreatBroadcast(final Faction faction)
    {
        /* DELIBERATELY SILENT, because the banner it used to raise told players the server was
         * going down.
         *
         * EmergencyMessage does not carry text: the client takes the string, wraps it as
         * "%$bgo." + s + ".description%" (NotificationProtocol.cs:169-176) and looks it up. We were
         * sending a literal English sentence, which resolves to nothing, and the unresolved banner
         * falls back to the maintenance warning - so every outpost kill announced an imminent
         * shutdown. Nothing in the client's locale describes an outpost retreating, and there is no
         * other broadcast writer that renders literal text, so there is no honest message to send.
         * The retreat is visible in-world anyway: the outpost plays its FTL jump-out.
         * Restore this the day a suitable loca key exists - pass the KEY, never a sentence. */
    }

    private void sendDealDamageTo(final DamageRecord damageRecord)
    {
        final SpaceObject castingShip = damageRecord.from();
        final SpaceObject targetShip = damageRecord.to();
        final boolean isCritical = damageRecord.isCritical();
        final boolean isDestroyed = damageRecord.to().isRemoved();
        final float damage = damageRecord.damage();

        if (castingShip.isPlayer())
        {
            final PlayerShip castingPlayerShip = (PlayerShip) castingShip;
            final Optional<User> optUser = ctx.users().getUser(castingPlayerShip.getPlayerId());
            if (optUser.isPresent())
            {
                final User client = optUser.get();
                client.send(gameProtocolWriteOnly.writeCombatInfo(true, targetShip.getObjectID(),
                        damageRecord.damage(), isDestroyed, isCritical));
                client.getPlayer().getCounterFacade().incrementCounter(
                        CounterCardType.damage_dealt,
                        sectorCards.sectorCard().getCardGuid(),
                        damage
                );
                if (targetShip.getSpaceEntityType() == SpaceEntityType.Outpost)
                {
                    client.getPlayer().getCounterFacade().incrementCounter(
                            CounterCardType.outposts_damage_dealt,
                            sectorCards.sectorCard().getCardGuid(),
                            damage
                    );
                }
                try
                {
                    this.lootClaimHolder.updateClaim(damageRecord, client);
                }
                catch (final Exception ex)
                {
                    log.error("Error updating loot claim", ex);
                }
            }
        }
        if (targetShip.isPlayer())
        {
            final PlayerShip targetPlayerShip = (PlayerShip) targetShip;
            final Optional<User> optUser = ctx.users().getUser(targetPlayerShip);
            if (optUser.isPresent())
            {
                final User otherClient = optUser.get();
                otherClient.send(gameProtocolWriteOnly.writeCombatInfo(false, castingShip.getObjectID(),
                        damageRecord.damage(), isDestroyed, isCritical));
                otherClient.getPlayer().getCounterFacade().incrementCounter(
                        CounterCardType.damage_received,
                        sectorCards.sectorCard().getCardGuid(),
                        damage
                );
                if (castingShip.getSpaceEntityType() == SpaceEntityType.Outpost)
                {
                    otherClient.getPlayer().getCounterFacade().incrementCounter(
                            CounterCardType.outposts_damage_received,
                            sectorCards.sectorCard().getCardGuid(),
                            damage
                    );
                }
            }

        }

        if (targetShip.getFaction() != Faction.Neutral)
        {
            castingShip.getSpaceSubscribeInfo().setLastCombatTime(ctx.tick().getTimeStamp());
            targetShip.getSpaceSubscribeInfo().setLastCombatTime(ctx.tick().getTimeStamp());
        }
    }

    public void dealDamageFromAsteroidCollision(final Asteroid asteroid, final SpaceObject to)
    {
        final DamageRecord res = this.damageCalculator.calculateDamageFromCollision(asteroid, to);
        this.dealDamage(res);
    }
    public void dealDamageFromMissile(final Missile missile, final SpaceObject to)
    {
        // assuming this is of type torpedo
        if (missile.getSpaceSubscribeInfo().containsStat(ObjectStat.DrainLow))
        {
            if (missile.getSpaceSubscribeInfo().containsStat(ObjectStat.AoeDropoffIndex))
            {
                log.warn("AoeDropoffIndex is not supported for AoE missiles!");
            }
            List<DamageRecord> damageRecords = damageCalculator.calculateDamageFromTorpedo(missile, ctx.spaceObjects(), missile.getSpaceSubscribeInfo().getStatOrDefault(ObjectStat.AoeDropoffIndex, 1));
            for (DamageRecord damageRecord : damageRecords)
            {
                this.dealDamage(damageRecord);
            }
        }
        // assume this is a basic missile
        else
        {
            final DamageRecord res = this.damageCalculator.calculateDamageFromMissile(missile, to);
            this.dealDamage(res);
        }
    }
    public void dealDamageFromAbility(final SpaceObject from, final SpaceObject to, final ShipAbility ability)
    {
        final DamageRecord res = this.damageCalculator.calculateDamage(from, to, ability);
        this.dealDamage(res);
    }

    public void dealDamageFromMining(final Ship castingShip, final SpaceObject target, final ShipAbility ability)
    {
        final DamageRecord res = this.damageCalculator.calculateDamageMining(castingShip, target, ability);
        this.dealDamage(res);
    }
}
