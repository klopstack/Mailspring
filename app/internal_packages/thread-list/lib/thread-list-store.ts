import MailspringStore from 'mailspring-store';

import {
  Rx,
  Actions,
  Thread,
  QueryResultSet,
  WorkspaceStore,
  FocusedContentStore,
  FocusedPerspectiveStore,
} from 'mailspring-exports';
import { ListTabular, ListDataSource } from 'mailspring-component-kit';
import ThreadListDataSource from './thread-list-data-source';

class ThreadListStore extends MailspringStore {
  _dataSource?: ListDataSource;
  _dataSourceUnlisten: (() => void) | null;
  _hasMissingSizes: boolean = false;

  constructor() {
    super();
    // Respect the existing grouping preference, defaulting to threads when unset.
    if (!AppEnv.config.get('core.threadGrouping')) {
      AppEnv.config.set('core.threadGrouping', 'thread');
    }
    this.listenTo(FocusedPerspectiveStore, this._onPerspectiveChanged);
    this.createListDataSource();

    AppEnv.config.observe('core.lastUsedOrder', () => this.createListDataSource());
    AppEnv.config.observe('core.threadGrouping', () => this.createListDataSource());
  }

  dataSource = () => {
    if (!this._dataSource) {
      this._dataSource = new ListTabular.DataSource.Empty();
    }
    return this._dataSource;
  };

  hasMissingSizes = () => {
    return this._hasMissingSizes;
  };

  createListDataSource = () => {
    if (typeof this._dataSourceUnlisten === 'function') {
      this._dataSourceUnlisten();
    }
    const previousDataSource = this._dataSource;
    this._dataSourceUnlisten = null;

    const threadsSubscription = FocusedPerspectiveStore.current().threads();
    if (threadsSubscription) {
      const grouping = (AppEnv.config.get('core.threadGrouping') as string) || 'thread';
      this._dataSource = new ThreadListDataSource(threadsSubscription, grouping as any);
      this._dataSourceUnlisten = this._dataSource.listen(this._onDataChanged, this);
    } else {
      this._dataSource = new ListTabular.DataSource.Empty();
    }

    if (previousDataSource) {
      previousDataSource.cleanup();
    }

    this.trigger(this);
    Actions.setFocus({ collection: 'thread', item: null });
  };

  selectionObservable = () => {
    return Rx.Observable.fromListSelection<Thread>(this);
  };

  // Inbound Events

  _onPerspectiveChanged = () => {
    this.createListDataSource();
  };

  _onDataChanged = ({
    previous,
    next,
  }: { previous?: QueryResultSet<Thread>; next?: QueryResultSet<Thread> } = {}) => {
    // This code keeps the focus and keyboard cursor in sync with the thread list.
    // When the thread list changes, it looks to see if the focused thread is gone,
    // or no longer matches the query criteria and advances the focus to the next
    // thread.

    // This means that removing a thread from view in any way causes selection
    // to advance to the adjacent thread. Nice and declarative.
    if (previous && next) {
      const focused = FocusedContentStore.focused('thread');
      const keyboard = FocusedContentStore.keyboardCursor('thread');
      const viewModeAutofocuses =
        WorkspaceStore.layoutMode() === 'split' || WorkspaceStore.topSheet().root === true;

      const nextQ = next.query();
      const matchers = nextQ && nextQ.matchers();

      const focusedIndex = focused ? previous.offsetOfId(focused.id) : -1;
      const keyboardIndex = keyboard ? previous.offsetOfId(keyboard.id) : -1;

      const nextItemFromIndex = i => {
        let nextIndex;
        if (
          i > 0 &&
          ((next.modelAtOffset(i - 1) && next.modelAtOffset(i - 1).unread) || i >= next.count())
        ) {
          nextIndex = i - 1;
        } else {
          nextIndex = i;
        }

        // May return null if no thread is loaded at the next index
        return next.modelAtOffset(nextIndex);
      };

      const notInSet = function(model) {
        if (matchers) {
          return model.matches(matchers) === false;
        } else {
          return next.offsetOfId(model.id) === -1;
        }
      };

      if (viewModeAutofocuses && focused && notInSet(focused)) {
        Actions.setFocus({ collection: 'thread', item: nextItemFromIndex(focusedIndex) });
      }

      if (keyboard && notInSet(keyboard)) {
        Actions.setCursorPosition({
          collection: 'thread',
          item: nextItemFromIndex(keyboardIndex),
        });
      }
    }

    const orderBy: string | undefined = AppEnv.config.get('core.lastUsedOrder');
    const shouldCheckSizes = orderBy === '6' || orderBy === '7';
    const resultSet = next || previous;
    let hasMissingSizes = false;

    if (shouldCheckSizes && resultSet) {
      for (const thread of resultSet.models()) {
        const messages = (thread as any).__messages || [];
        if (
          messages.some(m => m && (m.size === null || m.size === undefined || m.size === 0))
        ) {
          hasMissingSizes = true;
          break;
        }
      }
    }

    if (this._hasMissingSizes !== hasMissingSizes) {
      this._hasMissingSizes = hasMissingSizes;
      this.trigger(this);
    }
  };
}

export default new ThreadListStore();
