import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, FileSpreadsheet, Plus, Printer, Trash2, Upload } from 'lucide-react';
import './pricing.css';

const sampleRows = [
  { sku: 'PART-001', name: 'Sample product', listPrice: 1000, netPrice: 800, quantity: 1, discount: 10, margin: 20, duty: 5, priceSource: 'net' },
];
const cleanHeader = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const parseAmount = (value) => {
  const parsed = Number(String(value ?? '').replace(/[,$\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const newId = () => Math.random().toString(36).slice(2, 10);
const calculate = (item) => {
  const sourcePrice = Number(item.priceSource === 'list' ? item.listPrice : item.netPrice) || 0;
  const discountedPrice = sourcePrice * (1 - (Number(item.discount) || 0) / 100);
  const marginRate = Math.min(99.99, Math.max(0, Number(item.margin) || 0)) / 100;
  const marginPrice = discountedPrice / (1 - marginRate);
  const customerPrice = marginPrice * (1 + (Number(item.duty) || 0) / 100);
  return { sourcePrice, discountedPrice, marginPrice, customerPrice, lineTotal: customerPrice * (Number(item.quantity) || 0) };
};
const money = (value, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value) || 0);
const field = (item, key, value) => ({ ...item, [key]: value });

function PricingWorkspace() {
  const [items, setItems] = useState(sampleRows.map((item) => ({ ...item, id: newId() })));
  const [currency, setCurrency] = useState('USD');
  const [sourceName, setSourceName] = useState('Sample pricing row');
  const [error, setError] = useState('');
  const total = useMemo(() => items.reduce((sum, item) => sum + calculate(item).lineTotal, 0), [items]);

  function update(id, key, value) {
    setItems((current) => current.map((item) => item.id === id ? field(item, key, value) : item));
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      let rows;
      if (file.name.toLowerCase().endsWith('.csv')) {
        const { default: Papa } = await import('papaparse');
        rows = await new Promise((resolve, reject) => Papa.parse(file, {
          skipEmptyLines: 'greedy',
          complete: (result) => resolve(result.data),
          error: reject,
        }));
      } else {
        const { default: readXlsxFile } = await import('read-excel-file/browser');
        rows = (await readXlsxFile(file))[0]?.data ?? [];
      }
      if (!rows || rows.length < 2) throw new Error('The workbook needs a header row and at least one item row.');
      const headers = rows[0].map(cleanHeader);
      const column = (...names) => headers.findIndex((header) => names.includes(header));
      const indexes = {
        sku: column('sku', 'partnumber', 'item', 'itemcode', 'productcode', 'servicepartnumber'),
        name: column('itemname', 'productname', 'description', 'servicedescription', 'name', 'product'),
        listPrice: column('listprice', 'listpriceusd', 'msrp', 'unitmsrp', 'extendedlistprice', 'extendedlistpriceusd'),
        netPrice: column('netprice', 'netpriceusd', 'discountedprice', 'discountedunitprice', 'specialdiscountedunitprice', 'partnerdiscountedunitpriceusd', 'extendednetprice', 'extendednetpriceusd'),
        quantity: column('quantity', 'qty'),
      };
      if (indexes.listPrice < 0 && indexes.netPrice < 0) throw new Error('Could not find a List/MSRP or Net/discounted price column in the header row.');
      const imported = rows.slice(1).flatMap((row) => {
        const read = (key) => indexes[key] < 0 ? '' : row[indexes[key]];
        let listPrice = parseAmount(read('listPrice'));
        let netPrice = parseAmount(read('netPrice'));
        const quantity = parseAmount(read('quantity')) || 1;
        if (indexes.listPrice >= 0 && /extended/.test(headers[indexes.listPrice]) && listPrice != null && quantity > 0) listPrice /= quantity;
        if (indexes.netPrice >= 0 && /extended/.test(headers[indexes.netPrice]) && netPrice != null && quantity > 0) netPrice /= quantity;
        if (listPrice == null && netPrice == null) return [];
        const defaultSource = netPrice != null ? 'net' : 'list';
        return [{
          id: newId(), sku: String(read('sku') ?? '').trim(), name: String(read('name') ?? '').trim() || String(read('sku') ?? '').trim() || 'Item',
          listPrice: listPrice ?? netPrice, netPrice: netPrice ?? listPrice, quantity,
          discount: 0, margin: 0, duty: 0, priceSource: defaultSource,
        }];
      });
      if (!imported.length) throw new Error('No rows with a valid List/MSRP or Net/discounted price were found.');
      setItems(imported);
      setSourceName(file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read this file.');
    } finally {
      event.target.value = '';
    }
  }

  function exportCsv() {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const headers = ['Part number', 'Description', 'Qty', 'Selected price list', 'List / MSRP', 'Net / discounted', 'Discount %', 'Discounted unit cost', 'Margin %', 'Price with margin', 'Duty %', 'Customer unit price', 'Line total'];
    const data = items.map((item) => {
      const result = calculate(item);
      return [item.sku, item.name, item.quantity, item.priceSource === 'list' ? 'List / MSRP' : 'Net / discounted', item.listPrice, item.netPrice, item.discount, result.discountedPrice, item.margin, result.marginPrice, item.duty, result.customerPrice, result.lineTotal];
    });
    const csv = [headers, ...data].map((row) => row.map(escape).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'quote-pricing.csv'; link.click(); URL.revokeObjectURL(url);
  }

  return <main className="pricing-page">
    <header className="pricing-header"><a className="pricing-brand" href="/">QuoteGen <span>/ Part pricing</span></a><button className="pricing-button secondary" onClick={() => window.print()}><Printer size={16} /> Print</button></header>
    <section className="pricing-intro"><p className="pricing-eyebrow">QUOTE WORKSPACE · INTERNAL PRICE BUILDER</p><h1>Part pricing<span>.</span></h1><p>Choose MSRP or net cost for each part, then calculate your customer unit price and line total.</p></section>
    <section className="pricing-source"><div><FileSpreadsheet size={19} /><span><strong>{sourceName}</strong><small>Import an Excel workbook or CSV price list</small></span></div><label className="pricing-button"><Upload size={15} /> Import price list<input type="file" accept=".xlsx,.csv" onChange={importFile} /></label></section>
    {error && <p className="pricing-error" role="alert">{error}</p>}
    <p className="pricing-formula"><strong>Calculation:</strong> selected price × (1 − discount%) ÷ (1 − margin%) × (1 + duty%) × quantity. Margin must be below 100%.</p>
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
    <div className="pricing-actions"><button className="pricing-button secondary" onClick={() => setItems((current) => [...current, { id: newId(), sku: '', name: '', listPrice: 0, netPrice: 0, quantity: 1, discount: 0, margin: 0, duty: 0, priceSource: 'net' }])}><Plus size={16} /> Add part</button><div className="pricing-total"><label>Currency <select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>USD</option><option>CAD</option><option>AUD</option><option>EUR</option><option>GBP</option></select></label><span>Quote total <strong>{money(total, currency)}</strong></span></div><button className="pricing-button primary" onClick={exportCsv}><Download size={16} /> Export calculations</button></div>
    <p className="pricing-footnote">This pricing worksheet runs in your browser. Imported workbooks are not uploaded.</p>
  </main>;
}

createRoot(document.getElementById('root')).render(<PricingWorkspace />);
