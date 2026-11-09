import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, FileSpreadsheet, Plus, Printer, Trash2, Upload } from 'lucide-react';
import './pricing.css';

const sampleRows = [
  { sku: 'PART-001', name: 'Sample product', listPrice: 1000, netPrice: 800, quantity: 1, discount: 10, margin: 20, duty: 5, priceSource: 'net' },
];
const cleanHeader = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const parseAmount = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '').trim().replace(/[,$\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};
const newId = () => Math.random().toString(36).slice(2, 10);
const calculate = (item) => {
  const sourcePrice = Number(item.priceSource === 'list' ? item.listPrice : item.netPrice) || 0;
  const discountRate = Math.min(100, Math.max(0, Number(item.discount) || 0)) / 100;
  const marginRate = Math.min(99.99, Math.max(0, Number(item.margin) || 0)) / 100;
  const dutyRate = Math.max(0, Number(item.duty) || 0) / 100;
  const discountedPrice = sourcePrice * (1 - discountRate);
  const marginPrice = discountedPrice / (1 - marginRate);
  const customerPrice = marginPrice * (1 + dutyRate);
  return { sourcePrice, discountedPrice, marginPrice, customerPrice, lineTotal: customerPrice * Math.max(0, Number(item.quantity) || 0) };
};
const money = (value, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value) || 0);
const aliases = {
  sku: ['sku', 'partnumber', 'partno', 'item', 'itemcode', 'productcode', 'servicepartnumber', 'enghousesku'],
  name: ['itemname', 'productname', 'description', 'servicedescription', 'name', 'product'],
  listPrice: ['listprice', 'listpriceusd', 'msrp', 'unitmsrp', 'extendedlistprice', 'extendedlistpriceusd', 'extlistprice', 'extlistpriceusd', 'listunitprice'],
  netPrice: ['netprice', 'netpriceusd', 'discountedprice', 'discountedunitprice', 'specialdiscountedunitprice', 'partnerdiscountedunitpriceusd', 'extendednetprice', 'extendednetpriceusd', 'extnetprice', 'extnetpriceusd', 'unitnetprice', 'unitprice'],
  quantity: ['quantity', 'qty'],
};
const matchColumn = (headers, key) => headers.findIndex((header) => aliases[key].includes(header));
const emptyPart = () => ({ id: newId(), sku: '', name: '', listPrice: 0, netPrice: 0, quantity: 1, discount: 0, margin: 0, duty: 0, priceSource: 'net' });

function findPriceTable(sheets) {
  let best = null;
  for (const { name, rows } of sheets) {
    for (let headerIndex = 0; headerIndex < Math.min(rows.length, 30); headerIndex += 1) {
      const headers = (rows[headerIndex] ?? []).map(cleanHeader);
      const indexes = Object.fromEntries(Object.keys(aliases).map((key) => [key, matchColumn(headers, key)]));
      const score = Number(indexes.sku >= 0) + Number(indexes.name >= 0) + Number(indexes.listPrice >= 0) + Number(indexes.netPrice >= 0) + Number(indexes.quantity >= 0);
      if ((indexes.listPrice >= 0 || indexes.netPrice >= 0) && (!best || score > best.score)) best = { name, rows, headerIndex, headers, indexes, score };
    }
  }
  return best;
}

function PricingWorkspace() {
  const [items, setItems] = useState(sampleRows.map((item) => ({ ...item, id: newId() })));
  const [currency, setCurrency] = useState('USD');
  const [sourceName, setSourceName] = useState('Sample pricing row');
  const [error, setError] = useState('');
  const [view, setView] = useState('pricing');
  const [customer, setCustomer] = useState('');
  const [customerCompany, setCustomerCompany] = useState('');
  const [quoteReference, setQuoteReference] = useState('');
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const total = useMemo(() => items.reduce((sum, item) => sum + calculate(item).lineTotal, 0), [items]);

  function update(id, key, value) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item));
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      let sheets;
      if (file.name.toLowerCase().endsWith('.csv')) {
        const { default: Papa } = await import('papaparse');
        const rows = await new Promise((resolve, reject) => Papa.parse(file, {
          skipEmptyLines: 'greedy',
          complete: (result) => resolve(result.data),
          error: reject,
        }));
        sheets = [{ name: 'CSV', rows }];
      } else {
        const { default: readXlsxFile } = await import('read-excel-file/browser');
        sheets = await readXlsxFile(file);
      }
      const table = findPriceTable(sheets);
      if (!table) throw new Error('Could not find a price column. Expected headers such as List Price/MSRP and Net Price/Discounted Price.');
      const read = (row, key) => table.indexes[key] < 0 ? '' : row[table.indexes[key]];
      const imported = table.rows.slice(table.headerIndex + 1).flatMap((row) => {
        let listPrice = parseAmount(read(row, 'listPrice'));
        let netPrice = parseAmount(read(row, 'netPrice'));
        const quantity = parseAmount(read(row, 'quantity')) || 1;
        if (table.indexes.listPrice >= 0 && /extended|^ext/.test(table.headers[table.indexes.listPrice]) && listPrice != null && quantity > 0) listPrice /= quantity;
        if (table.indexes.netPrice >= 0 && /extended|^ext/.test(table.headers[table.indexes.netPrice]) && netPrice != null && quantity > 0) netPrice /= quantity;
        if (listPrice == null && netPrice == null) return [];
        const sku = String(read(row, 'sku') ?? '').trim();
        const name = String(read(row, 'name') ?? '').trim() || sku || 'Item';
        return [{ id: newId(), sku, name, listPrice: listPrice ?? netPrice, netPrice: netPrice ?? listPrice, quantity, discount: 0, margin: 0, duty: 0, priceSource: netPrice != null ? 'net' : 'list' }];
      });
      if (!imported.length) throw new Error(`No rows with numeric list or net prices were found in ${table.name}.`);
      setItems(imported);
      setSourceName(`${file.name} · ${table.name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read this file.');
    } finally {
      event.target.value = '';
    }
  }

  function exportCsv() {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const headers = ['Part number', 'Description', 'Qty', 'Selected price list', 'List / MSRP', 'Net / discounted', 'Part discount %', 'Discounted unit cost', 'Margin %', 'Price with margin', 'Duty %', 'Customer unit price', 'Line total'];
    const data = items.map((item) => {
      const result = calculate(item);
      return [item.sku, item.name, item.quantity, item.priceSource === 'list' ? 'List / MSRP' : 'Net / discounted', item.listPrice, item.netPrice, item.discount, result.discountedPrice, item.margin, result.marginPrice, item.duty, result.customerPrice, result.lineTotal];
    });
    const csv = [headers, ...data].map((row) => row.map(escape).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'quote-pricing-internal.csv'; link.click(); URL.revokeObjectURL(url);
  }

  return <main className="pricing-page">
    <header className="pricing-header"><a className="pricing-brand" href="./">QuoteGen <span>/ Part pricing</span></a><div className="header-buttons"><a className="pricing-button secondary" href="./">Quote workspace</a><button className="pricing-button secondary" onClick={() => window.print()}><Printer size={16} /> Print</button></div></header>
    <section className="pricing-intro"><p className="pricing-eyebrow">QUOTE WORKSPACE · INTERNAL PRICE BUILDER</p><h1>Part pricing<span>.</span></h1><p>Choose MSRP or net cost for each part, then calculate your customer unit price and line total.</p></section>
    <section className="pricing-source"><div><FileSpreadsheet size={19} /><span><strong>{sourceName}</strong><small>Import an Excel workbook or CSV price list. We look for OEM-style SKU, quantity, MSRP/list and net price headers.</small></span></div><label className="pricing-button"><Upload size={15} /> Import price list<input type="file" accept=".xlsx,.csv" onChange={importFile} /></label></section>
    {error && <p className="pricing-error" role="alert">{error}</p>}
    <p className="pricing-formula"><strong>Calculation:</strong> selected price × (1 − part discount%) ÷ (1 − margin%) × (1 + duty%) × quantity. Margin must be below 100%. Rates and prices are applied separately to each part.</p>
    <nav className="view-tabs" aria-label="Pricing views"><button className={view === 'pricing' ? 'active' : ''} onClick={() => setView('pricing')}>Internal pricing</button><button className={view === 'customer' ? 'active' : ''} onClick={() => setView('customer')}>Customer quote preview</button></nav>
    {view === 'pricing' ? <>
      <div className="pricing-table-wrap"><table className="pricing-table"><thead><tr><th>Part / description</th><th>Price list</th><th>List / MSRP</th><th>Net / discounted</th><th>Qty</th><th>Discount %</th><th>Margin %</th><th>Duty %</th><th>Customer unit price</th><th>Line total</th><th aria-label="Actions" /></tr></thead><tbody>
        {items.map((item) => { const result = calculate(item); return <tr key={item.id}>
          <td className="item-cell"><input aria-label="Part number" placeholder="Part number" value={item.sku} onChange={(event) => update(item.id, 'sku', event.target.value)} /><input aria-label="Description" placeholder="Description" value={item.name} onChange={(event) => update(item.id, 'name', event.target.value)} /></td>
          <td><select aria-label={`Price list for ${item.sku || item.name}`} value={item.priceSource} onChange={(event) => update(item.id, 'priceSource', event.target.value)}><option value="list">List / MSRP</option><option value="net">Net / discounted</option></select></td>
          <td><input aria-label="List price or MSRP" type="number" min="0" step="0.01" value={item.listPrice} onChange={(event) => update(item.id, 'listPrice', event.target.value)} /></td>
          <td><input aria-label="Net or discounted price" type="number" min="0" step="0.01" value={item.netPrice} onChange={(event) => update(item.id, 'netPrice', event.target.value)} /></td>
          <td><input aria-label="Quantity" type="number" min="0" step="1" value={item.quantity} onChange={(event) => update(item.id, 'quantity', event.target.value)} /></td>
          <td><input aria-label="Part discount percent" type="number" min="0" max="100" step="0.01" value={item.discount} onChange={(event) => update(item.id, 'discount', event.target.value)} /></td>
          <td><input aria-label="Margin percent" type="number" min="0" max="99.99" step="0.01" value={item.margin} onChange={(event) => update(item.id, 'margin', event.target.value)} /></td>
          <td><input aria-label="Duty percent" type="number" min="0" step="0.01" value={item.duty} onChange={(event) => update(item.id, 'duty', event.target.value)} /></td>
          <td className="calculated-cell">{money(result.customerPrice, currency)}</td><td className="calculated-cell">{money(result.lineTotal, currency)}</td>
          <td><button className="pricing-icon-button" title="Remove part" aria-label={`Remove ${item.name}`} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={15} /></button></td>
        </tr>; })}
      </tbody></table></div>
      <div className="pricing-actions"><button className="pricing-button secondary" onClick={() => setItems((current) => [...current, emptyPart()])}><Plus size={16} /> Add part</button><div className="pricing-total"><label>Currency <select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>USD</option><option>CAD</option><option>AUD</option><option>EUR</option><option>GBP</option></select></label><span>Quote total <strong>{money(total, currency)}</strong></span></div><button className="pricing-button primary" onClick={exportCsv}><Download size={16} /> Export internal CSV</button></div>
    </> : <section className="customer-quote" aria-label="Customer quote preview">
      <div className="customer-fields no-print"><label>Customer name<input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Customer contact" /></label><label>Company<input value={customerCompany} onChange={(event) => setCustomerCompany(event.target.value)} placeholder="Company name" /></label><label>Quote reference<input value={quoteReference} onChange={(event) => setQuoteReference(event.target.value)} placeholder="Reference" /></label><label>Quote date<input type="date" value={quoteDate} onChange={(event) => setQuoteDate(event.target.value)} /></label></div>
      <div className="customer-paper"><div className="customer-paper-head"><div><span className="customer-kicker">COMMERCIAL PROPOSAL</span><h2>Customer quote</h2></div><div className="customer-meta">{quoteReference && <p><strong>Reference</strong> {quoteReference}</p>}<p><strong>Date</strong> {quoteDate || '—'}</p></div></div>
        {(customer || customerCompany) && <div className="customer-recipient"><strong>Prepared for</strong>{customer && <span>{customer}</span>}{customerCompany && <span>{customerCompany}</span>}</div>}
        <table className="customer-table"><thead><tr><th>PART NUMBER</th><th>DESCRIPTION</th><th>QTY</th><th>UNIT PRICE</th><th className="right">AMOUNT</th></tr></thead><tbody>{items.map((item) => { const result = calculate(item); return <tr key={item.id}><td>{item.sku || '—'}</td><td>{item.name || 'Item'}</td><td>{Number(item.quantity) || 0}</td><td>{money(result.customerPrice, currency)}</td><td className="right">{money(result.lineTotal, currency)}</td></tr>; })}</tbody></table>
        <div className="customer-total"><span>Total</span><strong>{money(total, currency)}</strong></div><p className="customer-thanks">Thank you for the opportunity to work together.</p>
      </div><div className="customer-actions no-print"><span>Only final customer prices are shown; OEM cost, discounts, margin and duty are hidden.</span><button className="pricing-button primary" onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button></div>
    </section>}
    <p className="pricing-footnote no-print">This pricing worksheet runs in your browser. Imported workbooks are not uploaded.</p>
  </main>;
}

createRoot(document.getElementById('root')).render(<PricingWorkspace />);
