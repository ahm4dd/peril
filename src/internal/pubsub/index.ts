import type { ConfirmChannel, ChannelModel } from "amqplib";
import amqp from "amqplib";
import { encode, decode } from "@msgpack/msgpack";
import { ExchangeDeadLetterFanout } from "../routing/routing.js";

export type SimpleQueueType = "durable" | "transient";
export type AckType = "Ack" | "NackRequeue" | "NackDiscard";

export async function publishJSON<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value: T
): Promise<void> {
  const valueJSON = JSON.stringify(value);
  ch.publish(exchange, routingKey, Buffer.from(valueJSON), {
    contentType: "application/json",
  });
}

export async function publishMsgPack<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value: T
): Promise<void> {
  const valueMsgPack: Uint8Array = encode(value);
  ch.publish(exchange, routingKey, Buffer.from(valueMsgPack), {
    contentType: "application/x-msgpack",
  });
}

export async function declareAndBind(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType
): Promise<[amqp.Channel, amqp.Replies.AssertQueue]> {
  const channel = await conn.createChannel();

  const queue = await channel.assertQueue(queueName, {
    autoDelete: queueType === "transient" ? true : false,
    exclusive: queueType === "transient" ? true : false,
    durable: queueType === "durable" ? true : false,
    arguments: {
      "x-dead-letter-exchange": ExchangeDeadLetterFanout,
    },
  });

  await channel.bindQueue(queueName, exchange, key);
  return [channel, queue];
}

export async function subscribeJSON<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType
): Promise<void> {
  const [channel, queue] = await declareAndBind(
    conn,
    exchange,
    queueName,
    key,
    queueType
  );

  await channel.prefetch(1);

  await channel.consume(queue.queue, async (msg) => {
    if (!msg) {
      console.log("Consuming cancelled.");
      return;
    }

    const content = msg.content.toString("utf-8");
    if (!content) {
      return;
    }

    const msgParsedJSON = JSON.parse(content);
    const ackState = await handler(msgParsedJSON);

    switch (ackState) {
      case "Ack":
        console.log(
          `The following message has been acknowledged:\n${msgParsedJSON}`
        );
        channel.ack(msg);
        break;
      case "NackRequeue":
        console.log(
          `The following message has been negatively acknowledged (Requeue):\n${msgParsedJSON}`
        );
        channel.nack(msg, false, true);
        break;
      case "NackDiscard":
        console.log(
          `The following message has been negatively acknowledged (Discard):\n${msgParsedJSON}`
        );
        channel.nack(msg, false, false);
    }
  });
}

export async function subscribeMsgPack<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType
): Promise<void> {
  const [channel, queue] = await declareAndBind(
    conn,
    exchange,
    queueName,
    key,
    queueType
  );

  await channel.consume(queue.queue, async (msg) => {
    if (!msg) {
      console.log("Consuming cancelled.");
      return;
    }

    await channel.prefetch(1);

    const content = msg.content;
    if (!content) {
      return;
    }

    const decodedContent = await decode(content);
    const ackState = await handler(decodedContent as T);
    console.log(`${"*".repeat(10)}`);
    console.log("State : ", ackState);

    switch (ackState) {
      case "Ack":
        console.log(
          `The following message has been acknowledged:\n${decodedContent}`
        );
        channel.ack(msg);
        break;
      case "NackRequeue":
        console.log(
          `The following message has been negatively acknowledged (Requeue):\n${decodedContent}`
        );
        channel.nack(msg, false, true);
        break;
      case "NackDiscard":
        console.log(
          `The following message has been negatively acknowledged (Discard):\n${decodedContent}`
        );
        channel.nack(msg, false, false);
    }
  });
}
