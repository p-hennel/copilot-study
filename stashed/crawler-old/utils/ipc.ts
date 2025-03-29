import type { Subprocess } from "bun";
import { serialize, deserialize } from "bun:jsc";
import type { Logger } from "@logtape/logtape";
import type { CrawlCommand } from "$lib/utils";

export type CommandType = {
  command: CrawlCommand;
  token: string;
  gqlURL: string;
  restURL: string;
  fullPath?: string;
  branch?: string;
  from?: Date;
  to?: Date;
};

export enum ChildMessageType {
  Ready = "Child.Ready",
  Heartbeat = "Child.Heartbeat",
  Done = "Child.Done"
}

export enum ParentMessageType {
  Command = "Parent.Command",
  Kill = "Parent.Kill"
}

export function sendMessage(
  logger: Logger,
  type: ChildMessageType | ParentMessageType,
  content: any,
  proc?: NodeJS.Process
) {
  if (!proc && type in ParentMessageType && !(type in ChildMessageType)) {
    throw new Error("Process parameter must be available to send messages from parent to child!");
  }
  if (!proc) proc = process;
  if (!proc.send) {
    throw new Error("Process does not support IPC send function!");
  }
  logger.debug("preparing message");
  const _raw = serialize({
    type,
    data: content
  });
  proc.send(_raw);
}

export type IPCCB<M> = (type: M, content: any, subprocess?: Subprocess) => void;
export function handleChildMessage(logger: Logger, callback: IPCCB<ChildMessageType>) {
  const ipc = (message: any, subprocess: Subprocess) => {
    if (!message) {
      logger.warn("IPC: Empty message");
      return;
    }
    const decoded = deserialize(message);
    if (!decoded || !decoded.hasOwnProperty("type")) {
      logger.warn("IPC: Decoding message failed: {message} //\\\\ {decoded}", { message, decoded });
      return;
    }
    if (Object.values(ChildMessageType).includes(decoded.type)) {
      //logger.debug("received message {type}", { type: decoded.type, content: decoded.data})
      callback(decoded.type, decoded.data, subprocess);
    } else {
      logger.error("IPC: Received mismatching Message Type: {decoded}", { decoded });
    }
  };
  return ipc;
}
