import {
  Rx,
  ObservableListDataSource,
  DatabaseStore,
  Thread,
  Message,
  QueryResultSet,
  QuerySubscription,
  localized,
} from 'mailspring-exports';
import { SenderGroup, ThreadWithMessagesMetadata } from './types';

const latestMessage = (messages: Message[] = []) => {
  if (!messages || messages.length === 0) return null;
  return messages.reduce((current, candidate) => {
    if (!current) return candidate;
    const candidateTs = candidate.date ? new Date(candidate.date).getTime() : 0;
    const currentTs = current.date ? new Date(current.date).getTime() : 0;
    return candidateTs > currentTs ? candidate : current;
  }, null as Message | null);
};

const senderValue = (thread: any) => {
  const newest = latestMessage(thread.__messages);
  if (!newest) return '';
  const contactFallback = newest.from && newest.from[0];
  return (
    newest.fromName ||
    newest.fromEmail ||
    (contactFallback && (contactFallback.name || contactFallback.email)) ||
    ''
  ).toLowerCase();
};

const sizeValue = (thread: any) => {
  if (!thread.__messages || thread.__messages.length === 0) return 0;
  return thread.__messages.reduce((max, message) => {
    const value = message.size || 0;
    return value > max ? value : max;
  }, 0);
};

const sortThreads = (threads: any[], orderBy?: string) => {
  if (!orderBy) return threads;

  // Server-side ordering now handles sender/size; keep wire order intact.
  if (['4', '5', '6', '7'].includes(orderBy)) {
    return threads;
  }

  const apply = (comparator: (a: any, b: any) => number) => {
    return threads.slice().sort((a, b) => {
      const result = comparator(a, b);
      if (result !== 0) return result;
      return a.id.localeCompare(b.id);
    });
  };

  switch (orderBy) {
    case '4':
      return apply((a, b) => senderValue(a).localeCompare(senderValue(b)));
    case '5':
      return apply((a, b) => senderValue(b).localeCompare(senderValue(a)));
    case '6':
      return apply((a, b) => sizeValue(a) - sizeValue(b));
    case '7':
      return apply((a, b) => sizeValue(b) - sizeValue(a));
    default:
      return threads;
  }
};

const _observableForThreadMessages = (id, initialModels) => {
  const subscription = new QuerySubscription<Message>(
    DatabaseStore.findAll<Message>(Message, { threadId: id }),
    {
      initialModels: initialModels,
      emitResultSet: true,
    }
  );
  return Rx.Observable.fromNamedQuerySubscription(`message-${id}`, subscription);
};

const _keyForSender = (thread: ThreadWithMessagesMetadata) => {
  const newest = latestMessage(thread.__messages);
  const contactFallback = newest && newest.from && newest.from[0];
  const email =
    (newest && newest.fromEmail) || (contactFallback && contactFallback.email) || 'unknown';
  const name =
    (newest && newest.fromName) || (contactFallback && contactFallback.name) || email || 'unknown';
  const key = (email || name).toLowerCase();
  return { key, email, name };
};

const _buildSenderGroups = (threads: ThreadWithMessagesMetadata[]) => {
  const groups = new Map<string, {
    threads: ThreadWithMessagesMetadata[];
    messages: Message[];
    displayName: string;
  }>();

  threads.forEach(thread => {
    const { key, name } = _keyForSender(thread);
    const normalizedKey = key || `unknown-${thread.id}`;
    const existing = groups.get(normalizedKey) || {
      threads: [],
      messages: [],
      displayName: name || localized('Unknown Sender'),
    };
    existing.threads.push(thread);
    existing.messages.push(...(thread.__messages || []));
    existing.displayName = existing.displayName || name || localized('Unknown Sender');
    groups.set(normalizedKey, existing);
  });

  const groupedModels: { [id: string]: SenderGroup } = {};
  const groupedIds: string[] = [];

  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    const countDiff = b[1].messages.length - a[1].messages.length;
    if (countDiff !== 0) return countDiff;
    const nameA = a[1].displayName.toLowerCase();
    const nameB = b[1].displayName.toLowerCase();
    return nameA.localeCompare(nameB);
  });

  sortedGroups.forEach(([key, entry]) => {
    const base = entry.threads[0];
    const group = new Thread(base) as SenderGroup;
    group.id = base.id;
    group.__groupType = 'sender';
    group.__groupThreads = entry.threads;
    group.__groupMessageCount = entry.messages.length;
    group.senderDisplayName = entry.displayName;
    group.senderKey = key;

    const sortedMessages = entry.messages
      .slice()
      .sort((a, b) => {
        const aTs = a.date ? new Date(a.date).getTime() : 0;
        const bTs = b.date ? new Date(b.date).getTime() : 0;
        return aTs - bTs;
      });

    group.__messages = sortedMessages;
    const latest = sortedMessages.length ? sortedMessages[sortedMessages.length - 1] : null;
    group.snippet = (latest && latest.snippet) || base.snippet;
    group.subject = `${localized('Messages from')} ${entry.displayName}`;
    group.unread = entry.threads.some(t => t.unread);
    group.starred = entry.threads.some(t => t.starred);
    group.attachmentCount = entry.threads.reduce((sum, t) => sum + (t.attachmentCount || 0), 0);

    if (latest && latest.date) {
      group.lastMessageReceivedTimestamp = new Date(latest.date) as any;
    } else {
      group.lastMessageReceivedTimestamp = base.lastMessageReceivedTimestamp;
    }

    groupedModels[group.id] = group;
    groupedIds.push(group.id);
  });

  return { ids: groupedIds, models: groupedModels };
};

const _flatMapJoiningMessages = ($threadsResultSet, grouping: 'thread' | 'sender') => {
  // Sender grouping used to combineLatest one observable per thread, which explodes
  // when you load large result sets. Instead, fetch message metadata in one query
  // per emitted thread set when grouping by sender, and keep the original reactive
  // per-thread observables for thread grouping.

  if (grouping === 'sender') {
    return $threadsResultSet.flatMapLatest(threadsResultSet => {
      const ids = threadsResultSet.ids();
      const promise = DatabaseStore.findAll<Message>(Message, { threadId: ids }).then(
        messages => {
          const messagesByThread = messages.reduce((acc, msg) => {
            if (!acc[msg.threadId]) acc[msg.threadId] = [];
            acc[msg.threadId].push(msg);
            return acc;
          }, {} as Record<string, Message[]>);

          const threadsWithMessages = {} as Record<string, ThreadWithMessagesMetadata>;
          threadsResultSet.models().forEach(thread => {
            const clone = new Thread(thread) as any;
            clone.__messages = (messagesByThread[thread.id] || []).filter(m => !m.isHidden());
            threadsWithMessages[clone.id] = clone;
          });

          const { ids: groupedIds, models } = _buildSenderGroups(Object.values(threadsWithMessages));
          const groupedSet = threadsResultSet.clone() as any;
          groupedSet._ids = groupedIds;
          groupedSet._idToIndexHash = null;
          return QueryResultSet.setByApplyingModels(groupedSet, models);
        }
      );

      return Rx.Observable.fromPromise(promise);
    });
  }

  // Default thread grouping keeps the reactive per-thread message observables.
  let $messagesResultSets = {};
  return (
    $threadsResultSet
      .flatMapLatest(threadsResultSet => {
        const missingIds = threadsResultSet.ids().filter(id => !$messagesResultSets[id]);
        let promise = null;
        if (missingIds.length === 0) {
          promise = Promise.resolve([threadsResultSet, []]);
        } else {
          promise = DatabaseStore.findAll<Message>(Message, { threadId: missingIds }).then(
            messages => {
              return Promise.resolve([threadsResultSet, messages]);
            }
          );
        }
        return Rx.Observable.fromPromise(promise);
      })
      .flatMapLatest(([threadsResultSet, messagesForNewThreads]) => {
        const messagesGrouped = {};
        for (const message of messagesForNewThreads) {
          if (messagesGrouped[message.threadId] == null) {
            messagesGrouped[message.threadId] = [];
          }
          messagesGrouped[message.threadId].push(message);
        }

        const oldSets = $messagesResultSets;
        $messagesResultSets = {};

        const sets = threadsResultSet.ids().map(id => {
          $messagesResultSets[id] =
            oldSets[id] || _observableForThreadMessages(id, messagesGrouped[id]);
          return $messagesResultSets[id];
        });
        sets.unshift(Rx.Observable.from([threadsResultSet]));

        return Rx.Observable.combineLatest(sets);
      })
      .flatMapLatest(([threadsResultSet, ...messagesResultSets]) => {
        const threadsWithMessages = {};
        threadsResultSet.models().forEach((thread, idx) => {
          const clone = new Thread(thread) as any;
          clone.__messages = messagesResultSets[idx] ? messagesResultSets[idx].models() : [];
          clone.__messages = clone.__messages.filter(m => !m.isHidden());
          threadsWithMessages[clone.id] = clone;
        });

        const sortedThreads = sortThreads(
          threadsResultSet.ids().map(id => threadsWithMessages[id]),
          AppEnv.config.get('core.lastUsedOrder')
        );

        const reorderedSet = threadsResultSet.clone() as any;
        reorderedSet._ids = sortedThreads.map(thread => thread.id);
        reorderedSet._idToIndexHash = null;

        return Rx.Observable.from([
          QueryResultSet.setByApplyingModels(reorderedSet, threadsWithMessages),
        ]);
      })
  );
};

class ThreadListDataSource extends ObservableListDataSource {
  _expandedGroups = new Set<string>();
  _groupingMode: 'thread' | 'sender';
  _rawResultSet: QueryResultSet<Thread> | null = null;
  _subject: Rx.Subject<QueryResultSet<Thread>>;
  _upstreamDispose?: Rx.Disposable;
  _startUpstream: () => void;

  constructor(subscription, grouping: 'thread' | 'sender') {
    const groupingMode: 'thread' | 'sender' = grouping === 'sender' ? 'sender' : 'thread';
    const $resultSetObservable = _flatMapJoiningMessages(
      Rx.Observable.fromNamedQuerySubscription('thread-list', subscription),
      groupingMode
    );

    const subject = new Rx.Subject<QueryResultSet<Thread>>();

    const startUpstream = () => {
      if (this._upstreamDispose) return;
      this._upstreamDispose = $resultSetObservable.subscribe(rs => {
        this._rawResultSet = rs;
        subject.onNext(this._applyExpansion(rs));
      });
    };

    const replaceRange = groupingMode === 'sender'
      ? () => {
          subscription.replaceRange({ start: 0, end: 10000 });
          startUpstream();
        }
      : (range: { start: number; end: number }) => {
          subscription.replaceRange(range);
          startUpstream();
        };

    super(subject, replaceRange);

    this._subject = subject;
    this._groupingMode = groupingMode;
    this._startUpstream = startUpstream;

    if (groupingMode === 'sender') {
      // Proactively request a wide window so grouping has complete data.
      subscription.replaceRange({ start: 0, end: 10000 });
      startUpstream();
    }
  }

  cleanup() {
    if (this._upstreamDispose) {
      this._upstreamDispose.dispose();
      this._upstreamDispose = null;
    }
    return super.cleanup();
  }

  groupingMode() {
    return this._groupingMode;
  }

  setExpandedGroups(ids: Set<string>) {
    if (this._groupingMode !== 'sender') return;
    this._expandedGroups = new Set(ids);
    if (this._rawResultSet) {
      this._subject.onNext(this._applyExpansion(this._rawResultSet));
    }
  }

  _applyExpansion = (resultSet: QueryResultSet<Thread>) => {
    if (this._groupingMode !== 'sender') return resultSet;

    const modelsHash = Object.assign({}, (resultSet as any)._modelsHash);
    const idsOut: string[] = [];

    resultSet.ids().forEach(id => {
      const model = resultSet.modelWithId(id) as SenderGroup;
      if (!model) return;

      // Always include the parent row
      const groupClone = new Thread(model) as SenderGroup;
      groupClone.__messages = (model as any).__messages;
      groupClone.__groupThreads = (model as any).__groupThreads;
      groupClone.__groupType = (model as any).__groupType;
      groupClone.__groupMessageCount = (model as any).__groupMessageCount;
      groupClone.senderDisplayName = (model as any).senderDisplayName;
      groupClone.senderKey = (model as any).senderKey;
      groupClone.__groupExpanded = this._expandedGroups.has(id);

      modelsHash[id] = groupClone as any;
      idsOut.push(id);

      if (
        groupClone.__groupExpanded &&
        groupClone.__groupThreads &&
        groupClone.__groupThreads.length > 0
      ) {
        groupClone.__groupThreads.forEach(child => {
          if (!child || child.id === id) return;
          const childClone = new Thread(child) as ThreadWithMessagesMetadata;
          (childClone as any).__messages = (child as any).__messages;
          (childClone as any).__groupChildOf = id;
          modelsHash[childClone.id] = childClone as any;
          idsOut.push(childClone.id);
        });
      }
    });

    const flattened = resultSet.clone() as any;
    flattened._ids = idsOut;
    flattened._idToIndexHash = null;
    return QueryResultSet.setByApplyingModels(flattened, modelsHash);
  };
}

export default ThreadListDataSource;
