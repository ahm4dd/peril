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
import { publishGameLog } from "./index.js";

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
  gs: GameState,
  ch: ConfirmChannel
): (rw: RecognitionOfWar) => Promise<AckType> {
  return async (rw: RecognitionOfWar) => {
    const warRes = handleWar(gs, rw);
    process.stdout.write("> ");

    let username = gs.getUsername();
    let message: string = "";

    let ack: AckType = "Ack";

    switch (warRes.result) {
      case WarOutcome.NotInvolved:
        ack = "NackRequeue";
        break;
      case WarOutcome.NoUnits:
        ack = "NackDiscard";
        break;
      case WarOutcome.OpponentWon:
      case WarOutcome.YouWon:
        message = `${warRes.winner} won a war against ${warRes.loser}`;
        break;
      case WarOutcome.Draw:
        message = `A war between ${warRes.attacker} and ${warRes.defender} resulted in a draw`;
        break;
      default:
        ack = "NackDiscard";
        break;
    }
    try {
      await publishGameLog(ch, username, message);
      return ack;
    } catch (err: unknown) {
      console.log(err);
      return "NackRequeue";
    }
  };
}
