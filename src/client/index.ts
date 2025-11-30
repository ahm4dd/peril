import amqp, { type ConfirmChannel } from "amqplib";
import {
  clientWelcome,
  commandStatus,
  getInput,
  printClientHelp,
  printQuit,
} from "../internal/gamelogic/gamelogic.js";
import {
  publishJSON,
  publishMsgPack,
  subscribeJSON,
} from "../internal/pubsub/index.js";
import {
  ArmyMovesPrefix,
  ExchangePerilDirect,
  ExchangePerilTopic,
  GameLogSlug,
  PauseKey,
  WarRecognitionsPrefix,
} from "../internal/routing/routing.js";
import { GameState } from "../internal/gamelogic/gamestate.js";
import { commandSpawn } from "../internal/gamelogic/spawn.js";
import { commandMove } from "../internal/gamelogic/move.js";
import { handlerMove, handlerPause, handlerWar } from "./handlers.js";
import type { GameLog } from "../internal/gamelogic/logs.js";

async function main() {
  console.log("Starting Peril client...");

  const connString = "amqp://guest:guest@localhost:5672";
  const conn = await amqp.connect(connString);

  console.log("Connected successfully");

  process.on("exit", async () => {
    console.log("\nProgram shutting down...");
    await conn.close();
  });

  const name = await clientWelcome();
  const gameState = new GameState(name);
  const channel = await conn.createConfirmChannel();

  await subscribeJSON(
    conn,
    ExchangePerilDirect,
    `${PauseKey}.${name}`,
    PauseKey,
    "transient",
    handlerPause(gameState)
  );
  await subscribeJSON(
    conn,
    ExchangePerilTopic,
    `${ArmyMovesPrefix}.${name}`,
    `${ArmyMovesPrefix}.*`,
    "transient",
    handlerMove(gameState, channel)
  );
  await subscribeJSON(
    conn,
    ExchangePerilTopic,
    `war`,
    `${WarRecognitionsPrefix}.${name}`,
    "durable",
    handlerWar(gameState, channel)
  );

  while (true) {
    let input = await getInput();
    switch (input[0]) {
      case "spawn": {
        console.log(input);
        commandSpawn(gameState, input);
        break;
      }
      case "move": {
        const armyMove = commandMove(gameState, input);

        if (armyMove) {
          await publishJSON(
            channel,
            ExchangePerilTopic,
            `${ArmyMovesPrefix}.*`,
            armyMove
          );
          console.log("The move was successful");
        }
        break;
      }
      case "status": {
        commandStatus(gameState);
        break;
      }
      case "help": {
        printClientHelp();
        break;
      }
      case "quit": {
        printQuit();
        process.exit();
      }
      default: {
        console.log("Command not found");
        continue;
      }
    }
  }
}

export async function publishGameLog(
  ch: ConfirmChannel,
  username: string,
  message: string
) {
  const log: GameLog = {
    message,
    username,
    timestamp: new Date(Date.now()),
  };

  await publishMsgPack(
    ch,
    ExchangePerilTopic,
    `${GameLogSlug}.${log.username}`,
    log
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
