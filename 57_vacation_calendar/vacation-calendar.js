(() => {
  'use strict';

  // ========================================
  // 設定
  // ========================================
  const APP_ID = 57;
  const SPACE_ID = 4; // 社内届け出書類スペース

  const FIELDS = {
    applicant: '申請者',
    startDate: '取得開始日',
    endDate: '終了日',
    vacationType: '休暇種別',
    status: 'ステータス',
    attendance: '勤怠',
    days: '取得日数',
    allDay: '終日',
  };

  // 休暇種別ごとの色設定
  const VACATION_COLORS = {
    '有給休暇':     { bg: '#4CAF50', text: '#fff' },
    '特別休暇':     { bg: '#2196F3', text: '#fff' },
    'シーズン休暇': { bg: '#FF9800', text: '#fff' },
    '振替休日':     { bg: '#9C27B0', text: '#fff' },
    '無給休暇':     { bg: '#9E9E9E', text: '#fff' },
    '遅刻／早退':   { bg: '#FFC107', text: '#333' },
    '忌引き':       { bg: '#455A64', text: '#fff' },
    'その他':       { bg: '#795548', text: '#fff' },
  };

  const DEFAULT_COLOR = { bg: '#607D8B', text: '#fff' };

  // ステータスによるスタイル区別
  const STATUS_STYLES = {
    '申請完了': 'vc-event--approved',
    '申請中':   'vc-event--pending',
  };

  // ========================================
  // ユーティリティ
  // ========================================
  function parseDate(str) {
    if (!str) return null;
    return new Date(str);
  }

  function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function getDayOfWeek(year, month, day) {
    return new Date(year, month, day).getDay();
  }

  const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

  function formatTime(date) {
    if (!date) return '';
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  // ========================================
  // スペースメンバーの表示名を取得
  // ========================================
  async function fetchSpaceMembers() {
    // スペースメンバー一覧を取得
    const spaceResp = await kintone.api(kintone.api.url('/k/v1/space/members.json', true), 'GET', {
      id: SPACE_ID,
    });
    // ユーザーのみ抽出（組織・グループを除外）
    const userCodes = spaceResp.members
      .filter((m) => m.entity.type === 'USER')
      .map((m) => m.entity.code);

    // 各ユーザーの表示名を取得
    const usersResp = await fetch('/v1/users.json?codes=' + userCodes.map((c) => encodeURIComponent(c)).join('&codes='), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const usersData = await usersResp.json();
    // code -> 表示名のマップ
    return usersData.users.map((u) => u.name);
  }

  // ========================================
  // kintone REST API でレコード取得（全件）
  // ========================================
  async function fetchAllRecords(year, month) {
    const startOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00Z`;
    const endOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-${getDaysInMonth(year, month)}T23:59:59Z`;

    // 月内に重なるレコードを取得
    const query = `${FIELDS.startDate} <= "${endOfMonth}" and ${FIELDS.endDate} >= "${startOfMonth}" order by ${FIELDS.applicant} asc, ${FIELDS.startDate} asc`;
    const fieldList = Object.values(FIELDS).join(',');

    let allRecords = [];
    let offset = 0;
    const limit = 500;

    while (true) {
      const resp = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', {
        app: APP_ID,
        query: `${query} limit ${limit} offset ${offset}`,
        fields: ['$id', ...Object.values(FIELDS)],
      });
      allRecords = allRecords.concat(resp.records);
      if (resp.records.length < limit) break;
      offset += limit;
    }

    return allRecords;
  }

  // ========================================
  // レコードをカレンダー用データに変換
  // ========================================
  function processRecords(records, year, month) {
    const daysInMonth = getDaysInMonth(year, month);
    const applicantsMap = new Map(); // 申請者名 -> イベント配列

    records.forEach((rec) => {
      const applicant = rec[FIELDS.applicant].value;
      const start = parseDate(rec[FIELDS.startDate].value);
      const end = parseDate(rec[FIELDS.endDate].value);
      const vacationType = rec[FIELDS.vacationType].value;
      const status = rec[FIELDS.status].value;
      const attendance = rec[FIELDS.attendance].value;
      const recordId = rec['$id'] ? rec['$id'].value : rec['レコード番号'].value;

      if (!start || !end) return;

      if (!applicantsMap.has(applicant)) {
        applicantsMap.set(applicant, []);
      }

      // 月内の該当日を特定
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month, daysInMonth, 23, 59, 59);
      const effectiveStart = start < monthStart ? monthStart : start;
      const effectiveEnd = end > monthEnd ? monthEnd : end;

      const startDay = effectiveStart.getDate();
      const endDay = effectiveEnd.getDate();

      // 時刻フォーマット（時間休用）
      const startTime = formatTime(start);
      const endTime = formatTime(end);
      const isAllDay = startTime === '00:00' && (endTime === '00:00' || endTime === '23:59');

      applicantsMap.get(applicant).push({
        startDay,
        endDay,
        vacationType,
        status,
        attendance,
        recordId,
        startTime,
        endTime,
        isAllDay,
        label: buildEventLabel(vacationType, attendance),
      });
    });

    return applicantsMap;
  }

  function buildEventLabel(vacationType, attendance) {
    if (attendance && attendance !== '終日休') {
      return attendance;
    }
    return vacationType;
  }

  // ========================================
  // カレンダー描画
  // ========================================
  class VacationCalendar {
    constructor(container) {
      this.container = container;
      this.today = new Date();
      this.year = this.today.getFullYear();
      this.month = this.today.getMonth();
      this.data = new Map();
      this.allMembers = []; // スペースメンバー全員の表示名
      this.loading = false;
    }

    async init() {
      this.render();
      try {
        this.allMembers = await fetchSpaceMembers();
      } catch (e) {
        console.warn('VacationCalendar: スペースメンバー取得失敗、レコードの申請者のみ表示', e);
      }
      await this.loadData();
    }

    async loadData() {
      if (this.loading) return;
      this.loading = true;
      this.showLoading(true);

      try {
        const records = await fetchAllRecords(this.year, this.month);
        this.data = processRecords(records, this.year, this.month);
        this.renderGrid();
      } catch (e) {
        console.error('VacationCalendar: データ取得エラー', e);
        this.showError('データの取得に失敗しました');
      } finally {
        this.loading = false;
        this.showLoading(false);
      }
    }

    render() {
      this.container.innerHTML = '';
      this.container.className = 'vc-container';

      // ヘッダー
      const header = document.createElement('div');
      header.className = 'vc-header';
      header.innerHTML = `
        <a class="vc-btn vc-btn--back" href="/k/${APP_ID}/" title="休暇申請 一覧へ戻る">← 一覧</a>
        <div class="vc-nav">
          <button class="vc-btn vc-btn--nav" data-action="prev">&lt;</button>
          <button class="vc-btn vc-btn--today" data-action="today">今日</button>
          <button class="vc-btn vc-btn--nav" data-action="next">&gt;</button>
        </div>
        <h2 class="vc-title"></h2>
        <div class="vc-legend"></div>
      `;
      this.container.appendChild(header);

      // ナビゲーションイベント
      header.querySelector('[data-action="prev"]').addEventListener('click', () => this.navigate(-1));
      header.querySelector('[data-action="next"]').addEventListener('click', () => this.navigate(1));
      header.querySelector('[data-action="today"]').addEventListener('click', () => this.goToday());

      // 凡例
      this.renderLegend(header.querySelector('.vc-legend'));

      // ローディング
      const loadingEl = document.createElement('div');
      loadingEl.className = 'vc-loading';
      loadingEl.textContent = '読み込み中...';
      loadingEl.style.display = 'none';
      this.container.appendChild(loadingEl);
      this.loadingEl = loadingEl;

      // エラー
      const errorEl = document.createElement('div');
      errorEl.className = 'vc-error';
      errorEl.style.display = 'none';
      this.container.appendChild(errorEl);
      this.errorEl = errorEl;

      // グリッド本体
      const gridWrapper = document.createElement('div');
      gridWrapper.className = 'vc-grid-wrapper';
      this.container.appendChild(gridWrapper);
      this.gridWrapper = gridWrapper;

      this.updateTitle();
    }

    renderLegend(container) {
      Object.entries(VACATION_COLORS).forEach(([name, color]) => {
        const item = document.createElement('span');
        item.className = 'vc-legend-item';
        item.innerHTML = `<span class="vc-legend-color" style="background:${color.bg}"></span>${name}`;
        container.appendChild(item);
      });
    }

    updateTitle() {
      const title = this.container.querySelector('.vc-title');
      title.textContent = `${this.year}年${this.month + 1}月`;
    }

    renderGrid() {
      const daysInMonth = getDaysInMonth(this.year, this.month);
      // スペースメンバー全員 + レコードにだけ存在する申請者を統合
      const memberSet = new Set(this.allMembers);
      this.data.forEach((_, name) => memberSet.add(name));
      const applicants = [...memberSet].sort();

      if (applicants.length === 0) {
        this.gridWrapper.innerHTML = '<div class="vc-empty">この月の休暇データはありません</div>';
        return;
      }

      // CSS Grid テンプレート列数 = 1（名前列） + 日数
      const colTemplate = `180px repeat(${daysInMonth}, 1fr)`;

      let html = `<div class="vc-grid" style="grid-template-columns: ${colTemplate};">`;

      // ヘッダー行：空セル + 日付
      html += '<div class="vc-cell vc-cell--header vc-cell--name">申請者</div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = getDayOfWeek(this.year, this.month, d);
        const isToday = this.year === this.today.getFullYear()
          && this.month === this.today.getMonth()
          && d === this.today.getDate();
        const dowClass = dow === 0 ? 'vc-cell--sun' : dow === 6 ? 'vc-cell--sat' : '';
        const todayClass = isToday ? 'vc-cell--today' : '';
        html += `<div class="vc-cell vc-cell--header vc-cell--date ${dowClass} ${todayClass}">
          <span class="vc-date-num">${d}</span>
          <span class="vc-date-dow">${WEEKDAY_LABELS[dow]}</span>
        </div>`;
      }

      // 各申請者の行
      applicants.forEach((name) => {
        const events = this.data.get(name) || [];
        // 名前セル
        html += `<div class="vc-cell vc-cell--name vc-cell--applicant">${this.escapeHtml(name)}</div>`;

        // 日付セル（イベントマッピング用）
        const dayMap = new Map();
        events.forEach((ev) => {
          for (let d = ev.startDay; d <= ev.endDay; d++) {
            if (!dayMap.has(d)) dayMap.set(d, []);
            dayMap.get(d).push(ev);
          }
        });

        for (let d = 1; d <= daysInMonth; d++) {
          const dow = getDayOfWeek(this.year, this.month, d);
          const isToday = this.year === this.today.getFullYear()
            && this.month === this.today.getMonth()
            && d === this.today.getDate();
          const dowClass = dow === 0 ? 'vc-cell--sun' : dow === 6 ? 'vc-cell--sat' : '';
          const todayClass = isToday ? 'vc-cell--today' : '';

          if (dayMap.has(d)) {
            const ev = dayMap.get(d)[0]; // 同日複数は先頭を表示
            const color = VACATION_COLORS[ev.vacationType] || DEFAULT_COLOR;
            const statusClass = STATUS_STYLES[ev.status] || '';
            const isStart = d === ev.startDay;
            const isEnd = d === ev.endDay;
            const roundClass = isStart && isEnd ? 'vc-event--single'
              : isStart ? 'vc-event--start'
              : isEnd ? 'vc-event--end'
              : 'vc-event--mid';

            html += `<div class="vc-cell vc-cell--day ${dowClass} ${todayClass}">
              <div class="vc-event ${statusClass} ${roundClass}"
                   style="background:${color.bg}; color:${color.text}"
                   data-record-id="${ev.recordId}"
                   title="${this.escapeHtml(ev.vacationType)}${ev.attendance ? ' (' + this.escapeHtml(ev.attendance) + ')' : ''}${!ev.isAllDay ? '\n' + ev.startTime + ' 〜 ' + ev.endTime : ''}">
                ${isStart ? this.escapeHtml(ev.label) : ''}
              </div>
            </div>`;
          } else {
            html += `<div class="vc-cell vc-cell--day ${dowClass} ${todayClass}"></div>`;
          }
        }
      });

      html += '</div>';
      this.gridWrapper.innerHTML = html;

      // イベントクリックでレコード詳細へ
      this.gridWrapper.querySelectorAll('.vc-event[data-record-id]').forEach((el) => {
        el.addEventListener('click', () => {
          const recordId = el.dataset.recordId;
          if (recordId) {
            window.open(`/k/${APP_ID}/show#record=${recordId}`, '_blank');
          }
        });
      });
    }

    navigate(delta) {
      this.month += delta;
      if (this.month < 0) { this.month = 11; this.year--; }
      if (this.month > 11) { this.month = 0; this.year++; }
      this.updateTitle();
      this.loadData();
    }

    goToday() {
      this.year = this.today.getFullYear();
      this.month = this.today.getMonth();
      this.updateTitle();
      this.loadData();
    }

    showLoading(show) {
      if (this.loadingEl) this.loadingEl.style.display = show ? 'block' : 'none';
    }

    showError(msg) {
      if (this.errorEl) {
        this.errorEl.textContent = msg;
        this.errorEl.style.display = 'block';
        setTimeout(() => { this.errorEl.style.display = 'none'; }, 5000);
      }
    }

    escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  }

  // ========================================
  // kintone イベント登録
  // ========================================
  kintone.events.on('app.record.index.show', (event) => {
    // カスタムビュー（ID指定不要、一覧画面に埋め込み）
    // kintone のカスタマイズビューのHTMLに <div id="vc-root"></div> を設定
    const root = document.getElementById('vc-root');
    if (!root) return event;

    // アプリの説明欄を非表示
    const desc = document.querySelector('.gaia-argoui-app-index-pager');
    if (desc && desc.previousElementSibling) desc.previousElementSibling.style.display = 'none';
    const appDesc = document.querySelector('.gaia-argoui-app-description');
    if (appDesc) appDesc.style.display = 'none';

    // 既に描画済みなら再描画しない
    if (root.dataset.vcInit === 'true') return event;
    root.dataset.vcInit = 'true';

    const calendar = new VacationCalendar(root);
    calendar.init();

    return event;
  });
})();
