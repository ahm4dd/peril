import amqp from "amqplib";
import {
  clientWelcome,
  commandStatus,
  getInput,
  printClientHelp,
  printQuit,
} from "../internal/gamelogic/gamelogic.js";
import { declareAndBind } from "../internal/pubsub/index.js";
import { ExchangePerilDirect, PauseKey } from "../internal/routing/routing.js";
import { GameState } from "../internal/gamelogic/gamestate.js";
import { commandSpawn } from "../internal/gamelogic/spawn.js";
import { commandMove } from "../internal/gamelogic/move.js";

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
  const channelAndQueue = await declareAndBind(
    conn,
    ExchangePerilDirect,
    `${PauseKey}.${name}`,
    PauseKey,
    "transient"
  );

  const gameState = new GameState(name);
  const input = await getInput();

  while (true) {
    switch (input[0]) {
      case "spawn": {
        console.log(input);
        commandSpawn(gameState, input);
        break;
      }
      case "move": {
        const armyMove = commandMove(gameState, input);

        if (armyMove) {
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

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
