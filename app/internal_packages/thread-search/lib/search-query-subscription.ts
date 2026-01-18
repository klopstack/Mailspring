import _ from 'underscore';
import {
  Actions,
  Thread,
  DatabaseStore,
  SearchQueryParser,
  ComponentRegistry,
  MutableQuerySubscription,
} from 'mailspring-exports';
import { SortOrder } from '../../../src/flux/attributes';

class SearchQuerySubscription extends MutableQuerySubscription<Thread> {
  _searchQuery: string;
  _accountIds: string[];
  _connections = [];
  _extDisposables = [];
  _searching = false;

  constructor(searchQuery, accountIds) {
    super(null, { emitResultSet: true });
    this._searchQuery = searchQuery;
    this._accountIds = accountIds;

    _.defer(() => this.performSearch());
  }

  replaceRange = ({ start, end }) => {
    // Keep a wider cached window around the viewport to avoid thrashing when
    // scrolling back and forth through search results.
    const paddedStart = Math.max(0, start - 300);
    const paddedEnd = end + 300;
    const next = this.query()?.clone()?.page(paddedStart, paddedEnd, 100, 300);
    if (next && !next.range().isEqual(this.query().range())) {
      this.replaceQuery(next);
    }
  };

  performSearch() {
    this._searching = true;
    this.performLocalSearch();
    this.performExtensionSearch();
  }

  performLocalSearch() {
    let dbQuery = DatabaseStore.findAll<Thread>(Thread);
    if (this._accountIds.length === 1) {
      dbQuery = dbQuery.where({ accountId: this._accountIds[0] });
    }

    try {
      const parsedQuery = SearchQueryParser.parse(this._searchQuery);
      dbQuery = dbQuery.structuredSearch(parsedQuery);
    } catch (e) {
      console.info('Failed to parse local search query, falling back to generic query', e);
      dbQuery = dbQuery.search(this._searchQuery);
    }

    const { order, orders } = this._orderingForThreads();

    dbQuery = dbQuery.background();
    dbQuery = orders ? dbQuery.order(orders) : dbQuery.order(order);
    dbQuery = dbQuery.limit(0);

    this.replaceQuery(dbQuery);
  }

  _orderingForThreads(): { order: SortOrder; orders: SortOrder[] | null } {
    let order = Thread.attributes.lastMessageReceivedTimestamp.descending();
    let orders: SortOrder[] | null = null;

    const orderBy: string | undefined = AppEnv.config.get('core.lastUsedOrder');
    if (orderBy) {
      switch (orderBy) {
        case '2':
          order = Thread.attributes.subject.ascending();
          break;

        case '3':
          order = Thread.attributes.subject.descending();
          break;

        case '0':
          order = Thread.attributes.lastMessageReceivedTimestamp.ascending();
          break;

        case '4':
          orders = [
            SortOrder.raw(
              "LOWER(COALESCE(Thread.lastMessageFromName, Thread.lastMessageFromEmail, '')) ASC"
            ),
            SortOrder.raw("LOWER(COALESCE(Thread.lastMessageFromEmail, '')) ASC"),
            Thread.attributes.lastMessageReceivedTimestamp.descending(),
            Thread.attributes.id.ascending(),
          ];
          break;

        case '5':
          orders = [
            SortOrder.raw(
              "LOWER(COALESCE(Thread.lastMessageFromName, Thread.lastMessageFromEmail, '')) DESC"
            ),
            SortOrder.raw("LOWER(COALESCE(Thread.lastMessageFromEmail, '')) DESC"),
            Thread.attributes.lastMessageReceivedTimestamp.descending(),
            Thread.attributes.id.ascending(),
          ];
          break;

        case '6':
          orders = [
            Thread.attributes.messageSizeTotal.ascending(),
            Thread.attributes.lastMessageReceivedTimestamp.descending(),
            Thread.attributes.id.ascending(),
          ];
          break;

        case '7':
          orders = [
            Thread.attributes.messageSizeTotal.descending(),
            Thread.attributes.lastMessageReceivedTimestamp.descending(),
            Thread.attributes.id.ascending(),
          ];
          break;

        default:
          order = Thread.attributes.lastMessageReceivedTimestamp.descending();
          break;
      }
    }

    return { order, orders };
  }

  _createResultAndTrigger() {
    super._createResultAndTrigger();
    if (this._searching) {
      this._searching = false;
      Actions.searchCompleted();
    }
  }

  _addThreadIdsToSearch(ids = []) {
    const currentResults = this._set && this._set.ids().length > 0;
    let searchIds = ids;
    if (currentResults) {
      const currentResultIds = this._set.ids();
      searchIds = _.uniq(currentResultIds.concat(ids));
    }
    const { order, orders } = this._orderingForThreads();

    let dbQuery = DatabaseStore.findAll<Thread>(Thread).where({ id: searchIds });
    dbQuery = orders ? dbQuery.order(orders) : dbQuery.order(order);
    this.replaceQuery(dbQuery);
  }

  performRemoteSearch() {
    // TODO: Perform IMAP search here.
    //
    // This is temporarily disabled because we support Gmail's
    // advanced syntax locally (eg: in: inbox, is:unread), and
    // search message bodies, so local search is pretty much
    // good enough for v1. Come back and implement this soon!
    //
  }

  performExtensionSearch() {
    const searchExtensions = ComponentRegistry.findComponentsMatching({
      role: 'SearchBarResults',
    });

    this._extDisposables = searchExtensions.map(ext => {
      return ext.observeThreadIdsForQuery(this._searchQuery).subscribe((ids = []) => {
        const allIds = _.compact(_.flatten(ids));
        if (allIds.length === 0) return;
        this._addThreadIdsToSearch(allIds);
      });
    });
  }

  onLastCallbackRemoved() {
    this._connections.forEach(conn => conn.end());
    this._extDisposables.forEach(disposable => disposable.dispose());
  }
}

export default SearchQuerySubscription;
