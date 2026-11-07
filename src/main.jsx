import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, Check, Download, GripVertical, ImagePlus, LogOut, Pencil, Plus, ReceiptText, Search, Settings, Tags, Trash2, WalletCards, X } from 'lucide-react';
import './styles.css';
import './category-manager.css';

const money = (value) => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
const today = () => new Date().toLocaleDateString('sv-SE');
const currentMonth = () => today().slice(0, 7);

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '请求失败，请稍后重试');
  }
  return response.status === 204 ? null : response.json();
}

function EntryForm({ editing, busy, error, categories, onSave, onClose }) {
  const [type, setType] = useState(editing?.type || 'expense');
  const [category, setCategory] = useState(editing?.category || categories.expense[0]?.name || '');
  useEffect(() => {
    if (!category && categories[type][0]) setCategory(categories[type][0].name);
  }, [categories, category, type]);
  function changeType(nextType) {
    setType(nextType);
    if (!categories[nextType].some((item) => item.name === category)) setCategory(categories[nextType][0]?.name || '');
  }
  return <form onSubmit={onSave}>
    <fieldset className="type-switch"><legend>收支类型</legend>{['expense', 'income'].map((value) => <label key={value} className={`${type === value ? 'chosen' : ''} ${value}-choice`}><input type="radio" checked={type === value} onChange={() => changeType(value)} />{value === 'income' ? '收入' : '支出'}</label>)}</fieldset>
    <input type="hidden" name="type" value={type} />
    <label className="field-label">金额 <span>¥</span><input name="amount" type="number" min="0.01" max="999999999.99" step="0.01" defaultValue={editing?.amount ?? ''} placeholder="0.00" required /></label>
    <label className="field-label">分类<select name="category" value={category} onChange={(event) => setCategory(event.target.value)} required>{categories[type].map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
    <div className="field-row"><label className="field-label">日期 <span>可补录历史日期</span><input name="date" type="date" defaultValue={editing?.date || today()} required /></label><label className="field-label">备注 <span>选填</span><input name="note" type="text" maxLength="200" defaultValue={editing?.note || ''} placeholder="例如：供应商名称" /></label></div>
    {error && <p className="form-error">{error}</p>}<footer className="modal-footer"><button type="button" className="quiet-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy ? '保存中…' : '保存账目'}</button></footer>
  </form>;
}

function CategoryRow({ type, category, index, total, busy, dragging, onReorder, onRename, onRemove, onDragStart, onDrop, onDragEnd }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  useEffect(() => { setName(category.name); }, [category.name]);
  async function save(event) {
    event.preventDefault();
    if (await onRename(category, name)) setEditing(false);
  }
  return <div className={`category-row ${dragging ? 'dragging' : ''}`} draggable={!busy && !editing} onDragStart={(event) => onDragStart(event, type, category)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, type, index)} onDragEnd={onDragEnd}>
    {editing
      ? <form className="category-rename-form" onSubmit={save}><input aria-label="分类名称" value={name} onChange={(event) => setName(event.target.value)} maxLength="30" required autoFocus /><button type="submit" className="icon-button" title="保存" aria-label="保存分类名称" disabled={busy}><Check size={16} /></button><button type="button" className="icon-button" title="取消" aria-label="取消修改" onClick={() => { setEditing(false); setName(category.name); }}><X size={16} /></button></form>
      : <><span className="category-name"><GripVertical size={15} aria-hidden="true" />{category.name}</span><div className="category-actions"><button type="button" className="icon-button" title="修改名称" aria-label={`修改${category.name}`} disabled={busy} onClick={() => setEditing(true)}><Pencil size={15} /></button><button type="button" className="icon-button" title="上移" aria-label={`上移${category.name}`} disabled={busy || index === 0} onClick={() => onReorder(type, index, index - 1)}><ArrowUp size={15} /></button><button type="button" className="icon-button" title="下移" aria-label={`下移${category.name}`} disabled={busy || index === total - 1} onClick={() => onReorder(type, index, index + 1)}><ArrowDown size={15} /></button><button type="button" className="icon-button" title={`删除${category.name}`} aria-label={`删除${category.name}`} disabled={busy} onClick={() => onRemove(category)}><Trash2 size={16} /></button></div></>}
  </div>;
}

function ReceiptRow({ receipt, busy, onRename, onRemove, openUrl }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(receipt.name || '');
  useEffect(() => { setName(receipt.name || ''); }, [receipt.name]);
  async function save(event) {
    event.preventDefault();
    if (await onRename(receipt, name)) setEditing(false);
  }
  return <div className="receipt-item">
    {editing
      ? <form className="receipt-rename-form" onSubmit={save}><input aria-label="凭证文件名" value={name} onChange={(event) => setName(event.target.value)} maxLength="180" required autoFocus /><button type="submit" className="icon-button" title="保存" aria-label="保存文件名" disabled={busy}><Check size={16} /></button><button type="button" className="icon-button" title="取消" aria-label="取消改名" disabled={busy} onClick={() => { setEditing(false); setName(receipt.name || ''); }}><X size={16} /></button></form>
      : <><div><strong>{receipt.name || `凭证 ${receipt.id}`}</strong><span>{(receipt.sizeBytes / 1024 / 1024).toFixed(2)} MB · {receipt.createdAt}</span></div><a href={openUrl} target="_blank" rel="noreferrer">打开 / 下载</a><button type="button" className="icon-button" title="修改文件名" aria-label={`修改凭证文件名 ${receipt.name || receipt.id}`} disabled={busy} onClick={() => setEditing(true)}><Pencil size={15} /></button><button type="button" className="icon-button" title="删除凭证" aria-label="删除凭证" disabled={busy} onClick={() => onRemove(receipt)}><Trash2 size={16} /></button></>}
  </div>;
}

function App() {
  const [authenticated, setAuthenticated] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [needsLegacyClaim, setNeedsLegacyClaim] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [entries, setEntries] = useState([]);
  const [categories, setCategories] = useState({ expense: [], income: [] });
  const [summary, setSummary] = useState({ income: 0, expense: 0, count: 0 });
  const [month, setMonth] = useState(currentMonth());
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [receiptTransaction, setReceiptTransaction] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState('');
  const [draggingCategory, setDraggingCategory] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [page, setPage] = useState('ledger');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function loadData() {
    const [rows, totals, categoryRows, settings] = await Promise.all([request('/api/transactions'), request(`/api/summary?month=${month}`), request('/api/categories'), request('/api/settings')]);
    setEntries(rows);
    setSummary(totals);
    setCategories(categoryRows);
    setBusinessName(settings.businessName);
    setTitleDraft(settings.businessName);
  }
  useEffect(() => { request('/api/session').then((session) => { setAuthenticated(session.authenticated); setNeedsLegacyClaim(session.needsLegacyClaim); }).catch(() => setAuthenticated(false)); }, []);
  useEffect(() => { if (authenticated) loadData().catch((cause) => setError(cause.message)); }, [authenticated, month]);
  const ledgerTitle = `${businessName ? `${businessName} ` : ''}小账本`;
  useEffect(() => { document.title = ledgerTitle; }, [ledgerTitle]);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    const payload = { username: fields.get('username'), password: fields.get('password'), claimPassword: fields.get('claimPassword') };
    try {
      await request(authMode === 'signup' ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify(payload) });
      setAuthenticated(true);
    }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  async function saveEntry(event) {
    event.preventDefault(); setBusy(true); setError('');
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries()); payload.amount = Number(payload.amount);
    try {
      await request(editing ? `/api/transactions/${editing.id}` : '/api/transactions', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      setMonth(payload.date.slice(0, 7)); setModal(false); setEditing(null); await loadData();
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  async function removeEntry(entry) {
    if (!window.confirm(`确定删除「${entry.category}」这笔账目吗？`)) return;
    try { await request(`/api/transactions/${entry.id}`, { method: 'DELETE' }); await loadData(); }
    catch (cause) { setError(cause.message); }
  }
  async function openReceiptManager(entry) {
    setReceiptTransaction(entry);
    setReceipts([]);
    setReceiptError('');
    try {
      const current = await request(`/api/transactions/${entry.id}/receipts`);
      setReceipts(current);
      setEntries((rows) => rows.map((row) => row.id === entry.id ? { ...row, receiptCount: current.length } : row));
    }
    catch (cause) { setReceiptError(cause.message); }
  }
  async function uploadReceipts(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!receiptTransaction || files.length === 0) return;
    setReceiptBusy(true); setReceiptError('');
    try {
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} 超过 10MB 限制`);
        await request(`/api/transactions/${receiptTransaction.id}/receipts`, {
          method: 'POST',
          body: file,
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Receipt-Name': encodeURIComponent(file.name),
          },
        });
      }
      const saved = await request(`/api/transactions/${receiptTransaction.id}/receipts`);
      setReceipts(saved);
      setEntries((current) => current.map((entry) => entry.id === receiptTransaction.id ? { ...entry, receiptCount: saved.length } : entry));
    } catch (cause) {
      setReceiptError(cause.message);
      try {
        const current = await request(`/api/transactions/${receiptTransaction.id}/receipts`);
        setReceipts(current);
        setEntries((rows) => rows.map((entry) => entry.id === receiptTransaction.id ? { ...entry, receiptCount: current.length } : entry));
      } catch (refreshError) { setReceiptError(`${cause.message}；刷新凭证列表失败：${refreshError.message}`); }
    } finally { setReceiptBusy(false); }
  }
  async function removeReceipt(receipt) {
    if (!receiptTransaction || !window.confirm('确定删除这张凭证吗？')) return;
    setReceiptBusy(true); setReceiptError('');
    try {
      await request(`/api/transactions/${receiptTransaction.id}/receipts/${receipt.id}`, { method: 'DELETE' });
      const remaining = receipts.filter((item) => item.id !== receipt.id);
      setReceipts(remaining);
      setEntries((current) => current.map((entry) => entry.id === receiptTransaction.id ? { ...entry, receiptCount: remaining.length } : entry));
    } catch (cause) { setReceiptError(cause.message); } finally { setReceiptBusy(false); }
  }
  async function renameReceipt(receipt, name) {
    setReceiptBusy(true); setReceiptError('');
    try {
      const updated = await request(`/api/transactions/${receiptTransaction.id}/receipts/${receipt.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      setReceipts((current) => current.map((item) => item.id === receipt.id ? { ...item, name: updated.name } : item));
      return true;
    } catch (cause) { setReceiptError(cause.message); return false; }
    finally { setReceiptBusy(false); }
  }
  async function addCategory(event) {
    event.preventDefault(); setBusy(true); setError('');
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const category = await request('/api/categories', { method: 'POST', body: JSON.stringify(payload) });
      setCategories((current) => ({ ...current, [category.type]: [...current[category.type], category] }));
      form.reset();
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  async function removeCategory(category) {
    if (!window.confirm(`确定删除「${category.name}」分类吗？`)) return;
    setError('');
    try {
      await request(`/api/categories/${category.id}`, { method: 'DELETE' });
      setCategories((current) => ({ ...current, [category.type]: current[category.type].filter((item) => item.id !== category.id) }));
    } catch (cause) { setError(cause.message); }
  }
  async function renameCategory(category, name) {
    setBusy(true); setError('');
    try {
      const updated = await request(`/api/categories/${category.id}`, { method: 'PUT', body: JSON.stringify({ name }) });
      setCategories((current) => ({ ...current, [category.type]: current[category.type].map((item) => item.id === category.id ? updated : item) }));
      setEntries((current) => current.map((entry) => entry.type === category.type && entry.category === category.name ? { ...entry, category: updated.name } : entry));
      return true;
    } catch (cause) { setError(cause.message); return false; } finally { setBusy(false); }
  }
  async function saveTitle(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const settings = await request('/api/settings', { method: 'PUT', body: JSON.stringify({ businessName: titleDraft }) });
      setBusinessName(settings.businessName);
      setTitleDraft(settings.businessName);
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  function startCategoryDrag(event, type, category) {
    event.dataTransfer.effectAllowed = 'move';
    setDraggingCategory(`${type}:${category.id}`);
  }
  function dropCategory(event, type, index) {
    event.preventDefault();
    const [draggedType, draggedId] = (draggingCategory || '').split(':');
    const fromIndex = categories[type].findIndex((item) => item.id === Number(draggedId));
    setDraggingCategory(null);
    if (draggedType === type) reorderCategory(type, fromIndex, index);
  }
  async function reorderCategory(type, fromIndex, toIndex) {
    const reordered = [...categories[type]];
    if (toIndex < 0 || toIndex >= reordered.length || fromIndex === toIndex) return;
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setBusy(true); setError('');
    try {
      const saved = await request('/api/categories/order', {
        method: 'PUT',
        body: JSON.stringify({ type, ids: reordered.map((category) => category.id) }),
      });
      setCategories((current) => ({ ...current, [type]: saved }));
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  const filteredEntries = entries.filter((entry) => entry.date.startsWith(month) && (filter === 'all' || entry.type === filter) && (!query || `${entry.category} ${entry.note}`.toLowerCase().includes(query.toLowerCase())));
  function exportCsv() {
    const rows = [['日期', '类型', '分类', '金额', '备注'], ...filteredEntries.map((entry) => [entry.date, entry.type === 'income' ? '收入' : '支出', entry.category, entry.amount.toFixed(2), entry.note])];
    const csv = '\ufeff' + rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `经营流水-${month}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  if (authenticated === null) return <div className="loading-screen">正在打开账本…</div>;
  if (!authenticated) return <main className="login-screen"><form className="login-panel" onSubmit={login}><div className="brand-mark"><ReceiptText size={22} /></div><p className="eyebrow">PRIVATE LEDGER</p><h1>小账本</h1><p className="login-copy">把每天的经营收支，记得清清楚楚。</p><div className="auth-tabs"><button type="button" className={authMode === 'login' ? 'selected' : ''} onClick={() => { setAuthMode('login'); setError(''); }}>登录</button><button type="button" className={authMode === 'signup' ? 'selected' : ''} onClick={() => { setAuthMode('signup'); setError(''); }}>注册新账号</button></div><label htmlFor="username">用户名<span>2–32 位字母、数字、下划线或连字符</span></label><input id="username" name="username" type="text" autoComplete="username" minLength="2" maxLength="32" required autoFocus /><label htmlFor="password">{authMode === 'signup' ? '设置密码（至少 8 位，含字母和数字）' : '密码'}</label><input id="password" name="password" type="password" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} minLength={authMode === 'signup' ? 8 : undefined} maxLength="128" pattern={authMode === 'signup' ? '(?=.*[A-Za-z])(?=.*[0-9]).{8,128}' : undefined} title={authMode === 'signup' ? '密码需至少 8 位，并同时包含字母和数字' : undefined} required />{authMode === 'signup' && needsLegacyClaim && <><label htmlFor="claimPassword">旧版账本密码<span>用于认领升级前的账目</span></label><input id="claimPassword" name="claimPassword" type="password" autoComplete="current-password" maxLength="128" required /></>}{error && <p className="form-error">{error}</p>}<button className="primary-button login-submit" disabled={busy}>{busy ? '请稍候…' : authMode === 'signup' ? '创建账号' : '进入账本'}</button><p className="auth-note">每个账号使用独立账本。请妥善保管密码，暂不支持找回。</p></form><span className="login-note">{needsLegacyClaim ? '首个账号需验证旧版密码以继承现有账目' : '注册后可使用独立账本'}</span></main>;
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><ReceiptText size={20} /></div><div><strong>{ledgerTitle}</strong><span>个体经营流水</span></div></div><div className="side-label">账本</div><button className={`nav-item ${page === 'ledger' ? 'active' : ''}`} onClick={() => { setPage('ledger'); setError(''); }}><WalletCards size={18} />经营流水</button><button className={`nav-item ${page === 'categories' ? 'active' : ''}`} onClick={() => { setPage('categories'); setError(''); }}><Tags size={18} />分类管理</button><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => { setPage('settings'); setError(''); }}><Settings size={18} />设置</button><div className="side-bottom"><div className="secure-note"><span className="secure-dot" />数据已保存在本机</div><button className="logout-button" title="退出登录" onClick={async () => { await request('/api/logout', { method: 'POST' }); setAuthenticated(false); }}><LogOut size={17} />退出</button></div></aside>
    <main className="main-content">
      <header className="topbar"><div><p className="eyebrow">YOUR BUSINESS, IN ORDER</p><h1>{page === 'ledger' ? '经营流水' : page === 'categories' ? '分类管理' : '设置'}</h1></div>{page === 'ledger' && <div className="top-actions"><button className="quiet-button" onClick={exportCsv} title="导出当前筛选结果为 CSV"><Download size={17} /><span>导出账目</span></button><button className="primary-button" onClick={() => { setEditing(null); setModal(true); }}><Plus size={18} /><span>记一笔</span></button></div>}</header>
      {page === 'settings' ? <section className="ledger-section settings-panel"><div className="ledger-title"><div><p className="eyebrow">PERSONAL SETTINGS</p><h2>个人设置</h2></div></div>{error && <div className="notice-error">{error}<button onClick={() => setError('')} aria-label="关闭提示"><X size={15} /></button></div>}<form className="title-settings-form" onSubmit={saveTitle}><label className="field-label">个体户名称<span>显示格式：个体户名称 小账本；留空时显示“小账本”</span><input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength="40" placeholder="例如：张三餐饮店" /></label><button className="primary-button" disabled={busy}>保存名称</button></form></section> : page === 'categories' ? <section className="ledger-section category-manager">
        <div className="ledger-title"><div><p className="eyebrow">CUSTOM CATEGORIES</p><h2>管理收支分类</h2></div></div>
        <form className="category-add-form" onSubmit={addCategory}><label className="field-label">收支类型<select name="type" defaultValue="expense"><option value="expense">支出</option><option value="income">收入</option></select></label><label className="field-label">分类名称<input name="name" type="text" maxLength="30" placeholder="例如：设备维修" required /></label><button className="primary-button" disabled={busy}><Plus size={17} />添加分类</button></form>
        {error && <div className="notice-error">{error}<button onClick={() => setError('')} aria-label="关闭提示"><X size={15} /></button></div>}
        <div className="category-groups">{['expense', 'income'].map((type) => <section className="category-group" key={type}><header><h3>{type === 'expense' ? '支出分类' : '收入分类'}</h3><span>{categories[type].length} 个</span></header>{categories[type].map((category, index) => <CategoryRow key={category.id} type={type} category={category} index={index} total={categories[type].length} busy={busy} dragging={draggingCategory === `${type}:${category.id}`} onReorder={reorderCategory} onRename={renameCategory} onRemove={removeCategory} onDragStart={startCategoryDrag} onDrop={dropCategory} onDragEnd={() => setDraggingCategory(null)} />)}</section>)}</div>
        <p className="category-hint">可修改分类名称、拖动或用箭头排序；修改名称会同步更新该分类的历史账目，已使用的分类不能删除。</p>
      </section> : <>
      <section className="summary-grid" aria-label="本月收支概览"><article className="summary-card balance-card"><div className="summary-heading"><span>本月结余</span><span className="summary-symbol"><WalletCards size={17} /></span></div><strong>¥ {money(summary.income - summary.expense)}</strong><small>{month.replace('-', '年')}月 · 共 {summary.count} 笔流水</small></article><article className="summary-card"><div className="summary-heading"><span>本月收入</span><span className="summary-symbol income-symbol"><ArrowDownRight size={17} /></span></div><strong>¥ {money(summary.income)}</strong><small>含出货、人情及其他收入</small></article><article className="summary-card"><div className="summary-heading"><span>本月支出</span><span className="summary-symbol expense-symbol"><ArrowUpRight size={17} /></span></div><strong>¥ {money(summary.expense)}</strong><small>含进货、工资及日常开支</small></article></section>
      <section className="ledger-section"><div className="ledger-title"><div><p className="eyebrow">TRANSACTION HISTORY</p><h2>账目明细</h2></div><label className="month-picker"><span>月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label></div>
        <div className="toolbar"><div className="filter-tabs" role="group" aria-label="按收支筛选"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>全部</button><button className={filter === 'income' ? 'selected' : ''} onClick={() => setFilter('income')}>收入</button><button className={filter === 'expense' ? 'selected' : ''} onClick={() => setFilter('expense')}>支出</button></div><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索分类或备注" /></label></div>
        {error && <div className="notice-error">{error}<button onClick={() => setError('')} aria-label="关闭提示"><X size={15} /></button></div>}
        <div className="table-wrap"><table><thead><tr><th>日期</th><th>分类 / 备注</th><th>类型</th><th className="amount-cell">金额</th><th className="actions-heading">操作</th></tr></thead><tbody>{filteredEntries.map((entry) => <tr key={entry.id}><td className="date-cell">{entry.date}</td><td><strong className="entry-category">{entry.category}</strong><span className="entry-note">{entry.note || '—'}</span></td><td><span className={`type-label ${entry.type}`}>{entry.type === 'income' ? '收入' : '支出'}</span></td><td className={`amount-cell amount ${entry.type}`}>{entry.type === 'income' ? '+' : '−'} ¥ {money(entry.amount)}</td><td className="row-actions"><button title="凭证" aria-label={`管理${entry.category}凭证`} onClick={() => openReceiptManager(entry)}><ImagePlus size={16} />{entry.receiptCount > 0 && <span className="receipt-count">{entry.receiptCount}</span>}</button><button title="编辑" aria-label="编辑账目" onClick={() => { setEditing(entry); setModal(true); }}><Pencil size={16} /></button><button title="删除" aria-label="删除账目" onClick={() => removeEntry(entry)}><Trash2 size={16} /></button></td></tr>)}</tbody></table>
          {filteredEntries.length === 0 && <div className="empty-state"><div className="empty-icon"><ReceiptText size={22} /></div><strong>这个月还没有账目</strong><span>记下第一笔收支，经营情况就一目了然。</span><button className="text-button" onClick={() => { setEditing(null); setModal(true); }}><Plus size={16} />记一笔</button></div>}</div><div className="table-footer">显示 {filteredEntries.length} 笔 · 当前筛选月份：{month}</div>
      </section>
      </>}
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setModal(false); setError(''); } }}><section className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><p className="eyebrow">LEDGER ENTRY</p><h2 id="modal-title">{editing ? '编辑账目' : '记一笔'}</h2></div><button className="icon-button" onClick={() => { setModal(false); setError(''); }} aria-label="关闭"><X size={19} /></button></header><EntryForm key={editing?.id || 'new'} editing={editing} busy={busy} error={error} categories={categories} onSave={saveEntry} onClose={() => { setModal(false); setError(''); }} /></section></div>}
    {receiptTransaction && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !receiptBusy) setReceiptTransaction(null); }}><section className="entry-modal receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title"><header><div><p className="eyebrow">TRANSACTION RECEIPTS</p><h2 id="receipt-modal-title">流水凭证</h2><p className="receipt-transaction-label">{receiptTransaction.date} · {receiptTransaction.category} · ¥ {money(receiptTransaction.amount)}</p></div><button className="icon-button" onClick={() => setReceiptTransaction(null)} aria-label="关闭" disabled={receiptBusy}><X size={19} /></button></header><label className="field-label receipt-file-label">添加凭证<span>任意文件格式，可多选；每张不超过 10MB</span><input type="file" multiple disabled={receiptBusy} onChange={uploadReceipts} /></label>{receiptError && <p className="form-error">{receiptError}</p>}{receiptBusy && <p className="receipt-status">正在处理凭证…</p>}<div className="receipt-list">{receipts.map((receipt) => <ReceiptRow key={receipt.id} receipt={receipt} busy={receiptBusy} onRename={renameReceipt} onRemove={removeReceipt} openUrl={`/api/transactions/${receiptTransaction.id}/receipts/${receipt.id}`} />)}{receipts.length === 0 && !receiptBusy && <p className="receipt-empty">还没有凭证，可以在上方选择任意格式文件上传。</p>}</div><footer className="modal-footer"><button type="button" className="quiet-button" onClick={() => setReceiptTransaction(null)} disabled={receiptBusy}>完成</button></footer></section></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);