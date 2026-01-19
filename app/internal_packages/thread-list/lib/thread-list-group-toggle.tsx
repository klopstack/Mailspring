import React from 'react';
import { PropTypes, localized } from 'mailspring-exports';
import { toggleGroupById } from './group-toggle-handler';
import { SenderGroup } from './types';

export default class ThreadListGroupToggle extends React.Component<{ thread: any }> {
  static displayName = 'ThreadListGroupToggle';
  static propTypes = { thread: PropTypes.object };

  shouldComponentUpdate(nextProps) {
    return nextProps.thread !== this.props.thread;
  }

  _onClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!this.props.thread || (this.props.thread as any).__groupType !== 'sender') return;
    toggleGroupById(this.props.thread.id);
  };

  render() {
    const thread = this.props.thread as SenderGroup;
    if (!thread || (thread as any).__groupType !== 'sender') {
      return <span className="caret-placeholder" />;
    }

    const expanded = (thread as any).__groupExpanded;
    const glyph = expanded ? '▼' : '▶';

    return (
      <span
        className={`group-toggle-icon ${expanded ? 'expanded' : 'collapsed'}`}
        onClick={this._onClick}
        title={expanded ? localized('Collapse') : localized('Expand')}
        role="button"
        aria-label={expanded ? localized('Collapse sender group') : localized('Expand sender group')}
      >
        {glyph}
      </span>
    );
  }
}
