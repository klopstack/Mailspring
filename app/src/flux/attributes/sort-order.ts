import { Attribute } from './attribute';
import { Model } from '../models/model';

/*
Public: Represents a particular sort direction on a particular column. You should not
instantiate SortOrders manually. Instead, call {Attribute::ascending} or
{Attribute::descending} to obtain a sort order instance:

```javascript
DatabaseStore.findBy<Message>(Message)
  .where({threadId: threadId, draft: false})
  .order(Message.attributes.date.descending()).then((messages) =>

```

Section: Database
*/
export class SortOrder {
  public attr: Attribute | null;
  public direction: 'ASC' | 'DESC';
  public collation: string;
  private rawSQL?: string;

  constructor(attr: Attribute | null, direction: 'ASC' | 'DESC' = 'DESC', rawSQL?: string) {
    this.attr = attr;
    this.direction = direction;
    this.rawSQL = rawSQL;
  }

  static raw(sql: string) {
    return new SortOrder(null, 'ASC', sql);
  }

  orderBySQL(klass: typeof Model) {
    if (this.rawSQL) {
      return this.rawSQL;
    }
    if (!this.attr) {
      throw new Error('SortOrder requires an attribute unless raw SQL is provided');
    }
    return `\`${klass.name}\`.\`${this.attr.tableColumn}\` ${
      this.attr.applyCaseInsensitivity ? 'COLLATE NOCASE' : ''
    } ${this.direction}`;
  }

  attribute() {
    return this.attr;
  }
}
