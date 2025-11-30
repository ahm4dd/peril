import type { ConfirmChannel } from "amqplib";
import type {
  ArmyMove,
  RecognitionOfWar,
} from "../internal/gamelogic/gamedata.js";
import { handleMove, MoveOutcome } from "../internal/gamelogic/move.js";
import { publishJSON, type AckType } from "../internal/pubsub/index.js";
import {
  ExchangePerilTopic,
  WarRecognitionsPrefix,
} from "../internal/routing/routing.js";
import type {
  GameState,
  PlayingState,
} from "../internal/gamelogic/gamestate.js";
import { handlePause } from "../internal/gamelogic/pause.js";
import { handleWar, WarOutcome } from "../internal/gamelogic/war.js";

export function handlerPause(gs: GameState): (ps: PlayingState) => AckType {
  return (ps: PlayingState) => {
    handlePause(gs, ps);
    process.stdout.write("> ");
    return "Ack";
  };
}

export function handlerMove(
  gs: GameState,
  ch: ConfirmChannel
): (move: ArmyMove) => Promise<AckType> {
  return async (move: ArmyMove): Promise<AckType> => {
    try {
      const outcome = handleMove(gs, move);
      switch (outcome) {
        case MoveOutcome.Safe:
        case MoveOutcome.SamePlayer:
          return "Ack";
        case MoveOutcome.MakeWar:
          const recognition: RecognitionOfWar = {
            attacker: move.player,
            defender: gs.getPlayerSnap(),
          };

          try {
            await publishJSON(
              ch,
              ExchangePerilTopic,
              `${WarRecognitionsPrefix}.${gs.getUsername()}`,
              recognition
            );
          } catch (err) {
            console.error("Error publishing war recognition:", err);
            return "NackRequeue";
          } finally {
            return "Ack";
          }
        default:
          return "NackDiscard";
      }
    } finally {
      process.stdout.write("> ");
    }
  };
}

export function handlerWar(
  gs: GameState
): (rw: RecognitionOfWar) => Promise<AckType> {
  return async (rw: RecognitionOfWar) => {
    const warRes = handleWar(gs, rw);
    process.stdout.write("> ");

    switch (warRes.result) {
      case WarOutcome.NotInvolved:
        return "NackRequeue";
      case WarOutcome.NoUnits:
        return "NackDiscard";
      case WarOutcome.OpponentWon:
        return "Ack";
      case WarOutcome.YouWon:
        return "Ack";
      case WarOutcome.Draw:
        return "Ack";
      default:
        return "NackDiscard";
    }
  };
}
