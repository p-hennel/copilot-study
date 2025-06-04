/**
 * Protocol Handling Module
 * 
 * This module contains the implementation of message protocol handling
 * and validation, ensuring compatibility with the crawler's communication protocol.
 */

export { MessageValidator, createMessageValidator } from './message-validator.js';
export { MessageParser, StreamingMessageParser, createMessageParser, createStreamingMessageParser, MessageParserUtils } from './message-parser.js';
export { ProtocolHandler, ProtocolVersion, createProtocolHandler } from './protocol-handler.js';

// Re-export types for convenience
export type {
  MessageProcessingResult,
  CrawlerMessage,
  WebAppMessage,
  BaseMessage,
  ProgressData
} from '../types/index.js';

export type {
  ProtocolEvent,
  MessageEvent,
  ErrorEvent,
  StatusEvent
} from './protocol-handler.js';