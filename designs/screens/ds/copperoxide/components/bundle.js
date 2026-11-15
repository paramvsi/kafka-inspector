/* @ds-bundle: {"format":4,"namespace":"CopperOxide","components":[{"name":"Button"},{"name":"StatusBadge"},{"name":"KpiCard"},{"name":"Sparkline"},{"name":"SearchInput"},{"name":"SegmentedControl"},{"name":"NavItem"},{"name":"AlertItem"},{"name":"DataTable"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  function cx() {
    return Array.prototype.filter.call(arguments, Boolean).join(' ');
  }
  function omit(obj, keys) {
    var out = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && keys.indexOf(k) === -1) out[k] = obj[k];
    }
    return out;
  }

  function Button(props) {
    var variant = props.variant || 'secondary';
    var size = props.size || 'md';
    var rest = omit(props, ['variant', 'size', 'className', 'children']);
    return h('button', Object.assign({ type: 'button' }, rest, {
      className: cx('co-btn', 'co-btn-' + variant, 'co-btn-' + size, props.className)
    }), props.children);
  }

  var STATUS_LABEL = { healthy: 'Healthy', warn: 'Warn', stalled: 'Stalled', stopped: 'Stopped', neutral: 'Unknown' };
  function StatusBadge(props) {
    var status = props.status || 'neutral';
    return h('span', { className: cx('co-badge', 'co-badge-' + status, props.className) },
      props.dot === false ? null : h('span', { className: 'co-badge-dot', 'aria-hidden': 'true' }),
      props.children || STATUS_LABEL[status] || status);
  }

  var TONE_VAR = { ok: '--ok', warn: '--warn', crit: '--crit', 'chart-1': '--chart-1', 'chart-2': '--chart-2', muted: '--ink-muted' };
  function Sparkline(props) {
    var pts = props.points || [];
    var w = props.width || 90;
    var hgt = props.height || 18;
    var tone = props.tone || 'chart-1';
    if (pts.length < 2) return null;
    var min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    var span = max - min || 1;
    var step = w / (pts.length - 1);
    var coords = pts.map(function (v, i) {
      var y = max === min ? hgt / 2 : (hgt - 2) - ((v - min) / span) * (hgt - 4);
      return (i * step).toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return h('svg', {
      width: w, height: hgt, viewBox: '0 0 ' + w + ' ' + hgt,
      className: props.className, role: props.label ? 'img' : undefined,
      'aria-label': props.label, 'aria-hidden': props.label ? undefined : 'true'
    }, h('polyline', {
      points: coords, fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      style: { stroke: 'var(' + (TONE_VAR[tone] || '--chart-1') + ')' }
    }));
  }

  function KpiCard(props) {
    return h('div', { className: cx('co-kpi', props.className) },
      h('div', { className: 'co-kpi-label' }, props.label),
      h('div', { className: 'co-kpi-row' },
        h('span', { className: 'co-kpi-value' }, props.value),
        props.delta ? h('span', { className: cx('co-kpi-delta', 'co-tone-' + (props.deltaTone || 'neutral')) }, props.delta) : null),
      props.spark ? h(Sparkline, { points: props.spark, tone: props.sparkTone || 'chart-1', width: 168, height: 24, className: 'co-kpi-spark' }) : null);
  }

  function SearchInput(props) {
    var rest = omit(props, ['shortcut', 'label', 'className', 'width']);
    return h('label', { className: cx('co-search', props.className), style: props.width ? { width: props.width } : undefined },
      h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': 'true' },
        h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'M20 20l-3.5-3.5' })),
      h('input', Object.assign({ type: 'search', 'aria-label': props.label || 'Search', placeholder: 'Search topics, groups, offsets' }, rest)),
      props.shortcut === null ? null : h('span', { className: 'co-kbd', 'aria-hidden': 'true' }, props.shortcut || '⌘K'));
  }

  function SegmentedControl(props) {
    var options = props.options || [];
    var initial = props.defaultValue !== undefined ? props.defaultValue : (options[0] && (options[0].value || options[0]));
    var state = React.useState(initial);
    var value = props.value !== undefined ? props.value : state[0];
    return h('div', { className: cx('co-seg', props.className), role: 'group', 'aria-label': props.label || 'Options' },
      options.map(function (opt) {
        var v = typeof opt === 'string' ? opt : opt.value;
        var text = typeof opt === 'string' ? opt : (opt.label || opt.value);
        return h('button', {
          key: v, type: 'button', 'aria-pressed': v === value ? 'true' : 'false',
          onClick: function () { state[1](v); if (props.onChange) props.onChange(v); }
        }, text);
      }));
  }

  function NavItem(props) {
    return h('a', {
      href: props.href || '#', className: cx('co-nav', props.className),
      'aria-current': props.active ? 'page' : undefined
    }, props.label,
      props.count !== undefined && props.count !== null
        ? h('span', { className: cx('co-nav-count', props.countTone === 'crit' ? 'co-nav-count-crit' : null) }, props.count)
        : null);
  }

  function AlertItem(props) {
    var sev = props.severity || 'info';
    return h('div', { className: cx('co-alert', props.className) },
      h('span', { className: 'co-alert-dot co-alert-dot-' + sev, role: 'img', 'aria-label': sev === 'crit' ? 'Critical' : sev === 'warn' ? 'Warning' : 'Info' }),
      h('div', null,
        h('div', { className: 'co-alert-title' }, props.title),
        props.detail ? h('div', { className: 'co-alert-detail' }, props.detail) : null),
      props.time ? h('span', { className: 'co-alert-time' }, props.time) : null);
  }

  function DataTable(props) {
    var cols = props.columns || [];
    var rows = props.rows || [];
    return h('table', { className: cx('co-table', props.className) },
      props.caption ? h('caption', { style: { position: 'absolute', left: '-9999px' } }, props.caption) : null,
      h('thead', null, h('tr', null, cols.map(function (c) {
        return h('th', { key: c.key, scope: 'col', style: c.kind === 'num' ? { textAlign: 'right' } : undefined }, c.label);
      }))),
      h('tbody', null, rows.map(function (r, i) {
        return h('tr', { key: r[props.rowKey || 'id'] || i }, cols.map(function (c) {
          var cls = c.kind === 'num' ? 'co-num' : c.kind === 'id' ? 'co-id' : c.kind === 'dim' ? 'co-dim' : undefined;
          return h('td', { key: c.key, className: cls }, r[c.key]);
        }));
      })));
  }

  window.CopperOxide = Object.assign(window.CopperOxide || {}, {
    Button: Button,
    StatusBadge: StatusBadge,
    KpiCard: KpiCard,
    Sparkline: Sparkline,
    SearchInput: SearchInput,
    SegmentedControl: SegmentedControl,
    NavItem: NavItem,
    AlertItem: AlertItem,
    DataTable: DataTable
  });
})();
