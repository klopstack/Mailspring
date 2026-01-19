import { Message, Thread } from 'mailspring-exports';

export interface ThreadWithMessagesMetadata extends Thread {
  __messages: Message[];
  __groupChildOf?: string;
}

export interface SenderGroup extends ThreadWithMessagesMetadata {
  __groupType: 'sender';
  __groupThreads: ThreadWithMessagesMetadata[];
  __groupMessageCount: number;
  senderDisplayName?: string;
  senderKey?: string;
  __groupExpanded?: boolean;
}
