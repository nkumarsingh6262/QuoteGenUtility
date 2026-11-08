import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownToLine,
  Building2,
  Check,
  ChevronDown,
  FileSpreadsheet,
  Plus,
  Printer,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { parseEnghouseRenewalPdf, parseQuoteWorkbook } from './importer.js';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import './styles.css';

const sampleCatalog = [
  { sku: 'STR-01', name: 'Strategy workshop', description: 'Half-day discovery and planning session', category: 'Consulting', price: 1800 },
  { sku: 'DSN-02', name: 'Experience design', description: 'User flows, wireframes, and interface direction', category: 'Design', price: 2400 },
  { sku: 'DEV-03', name: 'Implementation', description: 'Frontend development and quality assurance', category: 'Development', price: 3200 },
  { sku: 'SUP-04', name: 'Launch support', description: 'Two weeks of post-launch support', category: 'Support', price: 850 },
];

const mappingFields = [
  { key: 'name', label: 'Item name', aliases: ['productname', 'itemname', 'product', 'service', 'item', 'title', 'name'] },
  { key: 'price', label: 'Unit price', aliases: ['unitprice', 'sellingprice', 'price', 'rate', 'amount', 'cost'] },
  { key: 'sku', label: 'SKU / code', aliases: ['sku', 'itemcode', 'productcode', 'partnumber', 'code', 'ref'] },
  { key: 'description', label: 'Description', aliases: ['description', 'details', 'specification', 'summary'] },
  { key: 'category', label: 'Category', aliases: ['category', 'group', 'type'] },
];

const makeId = () => Math.random().toString(36).slice(2, 10);
const maxQuoteSequence = 36 ** 6 - 1;
function allocateQuoteSequence(quoteSequenceStorageKey) {
  const savedSequence = localStorage.getItem(quoteSequenceStorageKey);
  if (savedSequence !== null && !/^\d+$/.test(savedSequence)) {
    throw new Error('The saved quote sequence is invalid.');
  }
  const currentSequence = savedSequence === null ? 0 : Number(savedSequence);
  if (!Number.isSafeInteger(currentSequence) || currentSequence < 0 || currentSequence >= maxQuoteSequence) {
    throw new Error('The saved quote sequence has reached its limit.');
  }
  const nextSequence = currentSequence + 1;
  localStorage.setItem(quoteSequenceStorageKey, String(nextSequence));
  return nextSequence;
}
const emptyEntities = () => Array.from({ length: 5 }, (_, index) => ({
  id: `entity-${index + 1}`,
  name: '',
  address: '',
}));
const readEntities = (entityStorageKey) => {
  try {
    const saved = JSON.parse(localStorage.getItem(entityStorageKey));
    const savedEntities = Array.isArray(saved) ? saved : saved?.entities;
    if (!Array.isArray(savedEntities)) return emptyEntities();
    return emptyEntities().map((entity) => {
      const savedEntity = savedEntities.find((item) => item.id === entity.id);
      return savedEntity
        ? { ...entity, name: String(savedEntity.name ?? ''), address: String(savedEntity.address ?? '') }
        : entity;
    });
  } catch {
    return emptyEntities();
  }
};
const readCompanyLogo = (entityStorageKey) => {
  try {
    const saved = JSON.parse(localStorage.getItem(entityStorageKey));
    return typeof saved?.logo === 'string' ? saved.logo : '';
  } catch {
    return '';
  }
};
const localDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const addDays = (count) => {
  const date = new Date();
  date.setDate(date.getDate() + count);
  return localDate(date);
};
const money = (value, currency) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency,
}).format(Number(value) || 0);
const formatDate = (value) => value
  ? new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  : '—';
const formatProposalDate = (value) => value
  ? new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' })
  : '—';
const formatQuoteNumber = (customer, date, sequence) => {
  const customerCode = String(customer ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'CUST';
  const [year, month, day] = (date || localDate()).split('-');
  return `TECS-${customerCode}-${day}${month}${year}-${sequence.toString(36).toUpperCase().padStart(6, '0')}`;
};

function normalized(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function detectMapping(headers) {
  return Object.fromEntries(mappingFields.map(({ key, aliases }) => {
    const index = headers.findIndex((header) => {
      const value = normalized(header);
      return aliases.some((alias) => value === alias || (value.length > 3 && value.includes(alias)));
    });
    return [key, index < 0 ? '' : String(index)];
  }));
}

function QuoteWorkspace() {
  const entityStorageKey = 'quotegen.entities.v1';
  const quoteSequenceStorageKey = 'quotegen.quote-sequence.v1';
  const [quoteType, setQuoteType] = useState('product');
  const [quoteSequence] = useState(() => {
    try {
      return { value: allocateQuoteSequence(quoteSequenceStorageKey), error: '' };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : 'Browser storage is unavailable.' };
    }
  });
  const [entities, setEntities] = useState(() => readEntities(entityStorageKey));
  const [entityDraft, setEntityDraft] = useState(entities);
  const [companyLogo, setCompanyLogo] = useState(() => readCompanyLogo(entityStorageKey));
  const [companyLogoDraft, setCompanyLogoDraft] = useState(companyLogo);
  const [companyLogoError, setCompanyLogoError] = useState('');
  const [companyLogoReading, setCompanyLogoReading] = useState(false);
  const [entityManagerOpen, setEntityManagerOpen] = useState(false);
  const [entitySaveError, setEntitySaveError] = useState('');
  const [catalog, setCatalog] = useState(sampleCatalog);
  const [catalogSource, setCatalogSource] = useState('Sample catalog');
  const [workbookSheets, setWorkbookSheets] = useState([]);
  const [selectedSheetName, setSelectedSheetName] = useState('');
  const [columnMapping, setColumnMapping] = useState({});
  const [importError, setImportError] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [lineItems, setLineItems] = useState([
    { id: makeId(), ...sampleCatalog[0], quantity: 1 },
    { id: makeId(), ...sampleCatalog[1], quantity: 1 },
    { id: makeId(), ...sampleCatalog[2], quantity: 1 },
  ]);
  const [quote, setQuote] = useState({
    date: localDate(),
    validUntil: addDays(30),
    reference: '',
    serviceStart: localDate(),
    serviceEnd: addDays(365),
    contractReference: '',
    currency: 'USD',
    customer: '',
    customerCompany: '',
    customerEmail: '',
    customerAddress: '',
    entityId: '',
    senderName: '',
    senderEmail: '',
    discount: '0',
    tax: '0',
    notes: 'Thank you for the opportunity to work together. Please reach out with any questions about this proposal.',
  });

  const activeSheet = workbookSheets.find((sheet) => sheet.name === selectedSheetName);
  const headers = activeSheet?.rows[0] ?? [];
  const selectedEntity = entities.find((entity) => entity.id === quote.entityId && entity.name.trim());
  const quoteNumber = quoteSequence.value === null
    ? 'Unavailable'
    : formatQuoteNumber(quote.customer, quote.date, quoteSequence.value);
  const totals = useMemo(() => {
    const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const discount = subtotal * (Number(quote.discount) || 0) / 100;
    const taxable = Math.max(0, subtotal - discount);
    const tax = taxable * (Number(quote.tax) || 0) / 100;
    return { subtotal, discount, tax, total: taxable + tax };
  }, [lineItems, quote.discount, quote.tax]);

  const setQuoteField = (field, value) => setQuote((current) => ({ ...current, [field]: value }));

  function openEntityManager() {
    setEntityDraft(entities.map((entity) => ({ ...entity })));
    setCompanyLogoDraft(companyLogo);
    setCompanyLogoError('');
    setEntitySaveError('');
    setEntityManagerOpen(true);
  }

  function handleCompanyLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setCompanyLogoReading(false);
    setCompanyLogoError('');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setCompanyLogoError('Choose a PNG, JPEG, WebP, or GIF image.');
      return;
    }
    if (file.size > 1024 * 1024) {
      setCompanyLogoError('The company logo must be 1 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    setCompanyLogoReading(true);
    reader.onload = () => {
      setCompanyLogoReading(false);
      if (typeof reader.result !== 'string') {
        setCompanyLogoError('Could not read the selected logo. Try another image.');
        return;
      }
      setCompanyLogoDraft(reader.result);
    };
    reader.onerror = () => {
      setCompanyLogoReading(false);
      setCompanyLogoError('Could not read the selected logo. Try another image.');
    };
    reader.readAsDataURL(file);
  }

  function saveEntities() {
    const cleanedEntities = entityDraft.map((entity) => ({
      ...entity,
      name: entity.name.trim(),
      address: entity.address.trim(),
    }));
    try {
      localStorage.setItem(entityStorageKey, JSON.stringify({ entities: cleanedEntities, logo: companyLogoDraft }));
      setEntities(cleanedEntities);
      setCompanyLogo(companyLogoDraft);
      setEntityManagerOpen(false);
      setCompanyLogoError('');
      setEntitySaveError('');
    } catch {
      setEntitySaveError('Could not save entity details and logo in this browser. Check your browser storage settings and try again.');
    }
  }

  async function handleWorkbook(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError('');
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
        if (file.name.toLowerCase().endsWith('.pdf')) {
          const [{ getDocument, GlobalWorkerOptions }] = await Promise.all([
            import('pdfjs-dist/legacy/build/pdf.mjs'),
          ]);
          GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
          const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
          const pdfItems = [];
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            pdfItems.push(...content.items);
          }
          const quoteImport = parseEnghouseRenewalPdf(pdfItems);
          applyQuoteImport(quoteImport, file.name);
          return;
        }
        const { default: readXlsxFile } = await import('read-excel-file/browser');
        const workbook = await readXlsxFile(file);
        sheets = workbook.map(({ sheet, data }, index) => ({ name: sheet || `Sheet ${index + 1}`, rows: data }));
      }
      if (!sheets.length || !sheets.some((sheet) => sheet.rows.length)) {
        setImportError('This workbook does not contain any rows to import.');
        return;
      }
      const quoteImport = parseQuoteWorkbook(sheets);
      if (quoteImport) {
        applyQuoteImport(quoteImport, file.name);
        return;
      }
      setCatalogSource(file.name);
      setWorkbookSheets(sheets);
      setSelectedSheetName(sheets[0].name);
      setColumnMapping(detectMapping(sheets[0].rows[0]));
    } catch {
      setImportError('We could not read this file. Try an .xlsx workbook or .csv file.');
    } finally {
      event.target.value = '';
    }
  }

  function applyQuoteImport(quoteImport, fileName) {
    setCatalogSource(fileName);
    setWorkbookSheets([]);
    if (quoteImport.error) {
      setImportError(quoteImport.error);
      return;
    }
    const metadata = quoteImport.metadata ?? {};
    const importedItems = quoteImport.items.map((item) => ({ ...item, id: makeId() }));
    setCatalog(importedItems.map(({ quantity, ...item }) => item));
    setLineItems(importedItems);
    setSelectedProduct('');
    setQuoteType(quoteImport.quoteType);
    setQuote((current) => ({
      ...current,
      currency: metadata.currency || 'USD',
      discount: metadata.discount || current.discount,
      customer: metadata.customer || current.customer,
      customerCompany: metadata.customerCompany || current.customerCompany,
      customerEmail: metadata.customerEmail || current.customerEmail,
      customerAddress: metadata.customerAddress || current.customerAddress,
      senderEmail: metadata.senderEmail || current.senderEmail,
      reference: metadata.reference || current.reference,
      date: metadata.date || current.date,
      validUntil: metadata.validUntil || current.validUntil,
      serviceStart: metadata.serviceStart || current.serviceStart,
      serviceEnd: metadata.serviceEnd || current.serviceEnd,
      contractReference: metadata.contractReference || current.contractReference,
    }));
    setImportError('');
  }

  function chooseSheet(name) {
    const sheet = workbookSheets.find((entry) => entry.name === name);
    setSelectedSheetName(name);
    setColumnMapping(detectMapping(sheet?.rows[0] ?? []));
  }

  function importCatalog() {
    if (columnMapping.name === '' || columnMapping.price === '') {
      setImportError('Map both Item name and Unit price to import this catalog.');
      return;
    }
    const imported = activeSheet.rows.slice(1).flatMap((row) => {
      const get = (field) => columnMapping[field] === '' || columnMapping[field] == null
        ? ''
        : String(row[Number(columnMapping[field])] ?? '').trim();
      const name = get('name');
      const rawPrice = get('price').replace(/[,$\s]/g, '');
      const price = Number(rawPrice);
      if (!name || !Number.isFinite(price)) return [];
      return [{
        sku: get('sku'),
        name,
        description: get('description'),
        category: get('category'),
        price,
      }];
    });
    if (!imported.length) {
      setImportError('No valid items found. Check the selected columns and make sure prices are numeric.');
      return;
    }
    setCatalog(imported);
    setLineItems([]);
    setSelectedProduct('');
    setWorkbookSheets([]);
    setImportError('');
  }

  function addLineItem() {
    const product = catalog[Number(selectedProduct)];
    if (!product) return;
    setLineItems((items) => [...items, { ...product, id: makeId(), quantity: 1 }]);
  }

  function updateLineItem(id, field, value) {
    setLineItems((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  function resetSampleCatalog() {
    setCatalog(sampleCatalog);
    setCatalogSource('Sample catalog');
    setLineItems([]);
    setWorkbookSheets([]);
    setImportError('');
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#top" aria-label="QuoteGen home">
          <span className="brand-mark">q<span>.</span></span>
          <span className="brand-name">quote<span>gen</span></span>
        </a>
        <div className="header-divider" />
        <span className="workspace-label">QUOTE WORKSPACE</span>
        <div className="header-actions">
          <span className="local-indicator"><span /> On this device</span>
          <button className="button button-primary header-print" disabled={quoteSequence.value === null} onClick={() => window.print()}>
            <Printer size={16} strokeWidth={2} /> Print quote
          </button>
        </div>
      </header>

      <main id="top" className="page-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">PROPOSALS / {quoteType === 'product' ? 'PRODUCT QUOTE' : 'AMC / RENEWAL QUOTE'}</p>
            <h1>Build a quote<span>.</span></h1>
            <p className="page-subtitle">A clear offer, ready to send.</p>
          </div>
          <div className="heading-number"><span>QUOTE</span><strong>{quoteNumber}</strong></div>
        </div>

        <div className="workspace">
          <section className="editor-column" aria-label="Quote editor">
            <section className="editor-section source-section">
              <div className="section-heading">
                <div className="step-number">01</div>
                <div><h2>Price list</h2><p>Choose the source for your items.</p></div>
              </div>
              <div className="source-row">
                <span className="source-icon"><FileSpreadsheet size={18} /></span>
                <span className="source-details"><strong>{catalogSource}</strong><small>{catalog.length} items available</small></span>
                <label className="icon-button upload-button" title="Import an Excel workbook" aria-label="Import an Excel workbook">
                  <Upload size={17} />
                  <input type="file" accept=".xlsx,.csv,.pdf" onChange={handleWorkbook} />
                </label>
              </div>
              {workbookSheets.length > 0 && (
                <div className="mapping-panel">
                  <div className="mapping-title"><strong>Match your columns</strong><span>Step 1 of 2</span></div>
                  <label className="field-label" htmlFor="sheet-select">Worksheet</label>
                  <div className="select-wrap">
                    <select id="sheet-select" value={selectedSheetName} onChange={(event) => chooseSheet(event.target.value)}>
                      {workbookSheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}
                    </select><ChevronDown size={15} />
                  </div>
                  <div className="mapping-grid">
                    {mappingFields.map(({ key, label }) => (
                      <label key={key} className="mapping-field">
                        <span>{label}{(key === 'name' || key === 'price') && <em> *</em>}</span>
                        <span className="select-wrap">
                          <select value={columnMapping[key] ?? ''} onChange={(event) => setColumnMapping((current) => ({ ...current, [key]: event.target.value }))}>
                            <option value="">Not mapped</option>
                            {headers.map((header, index) => <option key={`${index}-${header}`} value={String(index)}>{header || `Column ${index + 1}`}</option>)}
                          </select><ChevronDown size={14} />
                        </span>
                      </label>
                    ))}
                  </div>
                  <button className="button button-dark import-button" onClick={importCatalog}>
                    <Check size={15} /> Import {Math.max(0, (activeSheet?.rows.length ?? 1) - 1)} rows
                  </button>
                </div>
              )}
              {importError && <p className="form-error" role="alert">{importError}</p>}
              <div className="source-footer">
                <span>.xlsx, .csv or searchable .pdf · processed on this device</span>
                {catalogSource !== 'Sample catalog' && <button className="text-button" onClick={resetSampleCatalog}>Use sample list</button>}
                {catalogSource === 'Sample catalog' && <span className="sample-tag">SAMPLE</span>}
              </div>
            </section>

            <section className="editor-section">
              <div className="section-heading">
                <div className="step-number">02</div>
                <div><h2>Customer & quote</h2><p>Set the details that appear on the proposal.</p></div>
              </div>
              <div className="quote-type-control">
                <span className="control-label">QUOTE TYPE</span>
                <div className="segmented-control" role="group" aria-label="Quote type">
                  <button type="button" className={quoteType === 'product' ? 'segment-button active' : 'segment-button'} aria-pressed={quoteType === 'product'} onClick={() => setQuoteType('product')}>Product Quote</button>
                  <button type="button" className={quoteType === 'renewal' ? 'segment-button active' : 'segment-button'} aria-pressed={quoteType === 'renewal'} onClick={() => setQuoteType('renewal')}>AMC / Renewal Quote</button>
                </div>
              </div>
              <div className="entity-select-row">
                <label className="form-field entity-picker"><span>Issuing entity</span><span className="select-wrap">
                  <select value={quote.entityId} onChange={(event) => setQuoteField('entityId', event.target.value)}>
                    <option value="">Choose an entity</option>
                    {entities.map((entity, index) => <option key={entity.id} value={entity.id} disabled={!entity.name.trim()}>{entity.name.trim() || `Entity ${index + 1} (not configured)`}</option>)}
                  </select><ChevronDown size={14} />
                </span></label>
                <button className="button entity-manager-button" type="button" onClick={openEntityManager}><Building2 size={15} /> Manage entities</button>
              </div>
              {!selectedEntity && <p className="entity-help">Set up your entities, then choose which one is issuing this quote.</p>}
              <div className="form-grid">
                <label className="form-field"><span>Person name</span><input value={quote.customer} onChange={(event) => setQuoteField('customer', event.target.value)} placeholder="e.g. Alex Morgan" /></label>
                <label className="form-field"><span>Company name</span><input value={quote.customerCompany} onChange={(event) => setQuoteField('customerCompany', event.target.value)} placeholder="e.g. Northstar Labs" /></label>
                <label className="form-field"><span>Email</span><input type="email" value={quote.customerEmail} onChange={(event) => setQuoteField('customerEmail', event.target.value)} placeholder="name@company.com" /></label>
                <label className="form-field"><span>Reference details</span><input value={quote.reference} onChange={(event) => setQuoteField('reference', event.target.value)} placeholder="e.g. RFQ-2026-014" /></label>
                <label className="form-field"><span>Issue date</span><input type="date" value={quote.date} onChange={(event) => setQuoteField('date', event.target.value)} /></label>
                <label className="form-field"><span>Valid until</span><input type="date" value={quote.validUntil} onChange={(event) => setQuoteField('validUntil', event.target.value)} /></label>
                <label className="form-field"><span>Your email</span><input type="email" value={quote.senderEmail} onChange={(event) => setQuoteField('senderEmail', event.target.value)} placeholder="you@company.com" /></label>
              </div>
              {quoteSequence.error && <p className="form-error" role="alert">Quote number unavailable: {quoteSequence.error}</p>}
              {quoteType === 'renewal' && (
                <div className="renewal-fields">
                  <div className="renewal-heading"><strong>Renewal coverage</strong><span>Service period covered by this quote</span></div>
                  <label className="form-field"><span>Coverage starts</span><input type="date" value={quote.serviceStart} onChange={(event) => setQuoteField('serviceStart', event.target.value)} /></label>
                  <label className="form-field"><span>Coverage ends</span><input type="date" value={quote.serviceEnd} onChange={(event) => setQuoteField('serviceEnd', event.target.value)} /></label>
                  <label className="form-field renewal-reference"><span>Existing agreement / contract no. <small>(optional)</small></span><input value={quote.contractReference} onChange={(event) => setQuoteField('contractReference', event.target.value)} placeholder="e.g. AMC-2025-018" /></label>
                </div>
              )}
              <label className="form-field full-field"><span>Customer address</span><textarea rows="2" value={quote.customerAddress} onChange={(event) => setQuoteField('customerAddress', event.target.value)} placeholder="Street, city, postal code" /></label>
            </section>

            <section className="editor-section items-section">
              <div className="section-heading">
                <div className="step-number">03</div>
                <div><h2>Line items</h2><p>Pick from your price list, then adjust as needed.</p></div>
              </div>
              <div className="add-item-row">
                <span className="select-wrap product-select-wrap">
                  <select value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)} aria-label="Choose an item">
                    <option value="">Choose a product or service</option>
                    {catalog.map((item, index) => <option value={index} key={`${item.sku}-${index}`}>{item.name} · {money(item.price, quote.currency)}</option>)}
                  </select><ChevronDown size={15} />
                </span>
                <button className="button button-dark add-button" onClick={addLineItem} disabled={selectedProduct === ''}>
                  <Plus size={16} /> Add
                </button>
              </div>
              {lineItems.length === 0 ? (
                <div className="empty-items"><span className="empty-plus"><Plus size={17} /></span><span>Add an item to start your quote.</span></div>
              ) : (
                <div className="line-editor">
                  {lineItems.map((item) => (
                    <div className="line-edit-row" key={item.id}>
                      <div className="line-edit-description">
                        <input aria-label="Item name" value={item.name} onChange={(event) => updateLineItem(item.id, 'name', event.target.value)} />
                        <small>{item.sku || item.description || 'Custom line item'}</small>
                      </div>
                      <label className="compact-field"><span>Qty</span><input aria-label="Quantity" type="number" min="0" step="1" value={item.quantity} onChange={(event) => updateLineItem(item.id, 'quantity', Math.max(0, Number(event.target.value) || 0))} /></label>
                      <label className="compact-field price-field"><span>Unit price</span><input aria-label="Unit price" type="number" min="0" step="0.01" value={item.price} onChange={(event) => updateLineItem(item.id, 'price', Math.max(0, Number(event.target.value) || 0))} /></label>
                      <button className="icon-button remove-button" title="Remove item" aria-label={`Remove ${item.name}`} onClick={() => setLineItems((items) => items.filter((entry) => entry.id !== item.id))}><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="quote-adjustments">
                <label className="form-field"><span>Currency</span><span className="select-wrap"><select value={quote.currency} onChange={(event) => setQuoteField('currency', event.target.value)}><option value="USD">USD · $</option><option value="CAD">CAD · $</option><option value="AUD">AUD · $</option><option value="EUR">EUR · €</option><option value="GBP">GBP · £</option></select><ChevronDown size={14} /></span></label>
                <label className="form-field"><span>Discount</span><span className="input-suffix"><input type="number" min="0" max="100" value={quote.discount} onChange={(event) => setQuoteField('discount', event.target.value)} /><span>%</span></span></label>
                <label className="form-field"><span>Tax</span><span className="input-suffix"><input type="number" min="0" max="100" value={quote.tax} onChange={(event) => setQuoteField('tax', event.target.value)} /><span>%</span></span></label>
              </div>
              <div className="editor-total"><span>Quote total</span><strong>{money(totals.total, quote.currency)}</strong></div>
            </section>

            <section className="editor-section notes-section">
              <div className="section-heading">
                <div className="step-number">04</div>
                <div><h2>Closing note</h2><p>Add a short message to your customer.</p></div>
              </div>
              <label className="form-field full-field"><span>Note</span><textarea rows="3" value={quote.notes} onChange={(event) => setQuoteField('notes', event.target.value)} /></label>
            </section>
          </section>

          <section className="preview-column" aria-label="Customer quote preview">
            <div className="preview-toolbar"><span><span className="preview-dot" /> LIVE PREVIEW</span><button className="preview-print" disabled={quoteSequence.value === null} onClick={() => window.print()} title="Print or save as PDF"><ArrowDownToLine size={15} /> Save as PDF</button></div>
            <article className="quote-paper">
              <div className="quote-paper-topline"><div className="paper-issuer"><span className="paper-brand">{selectedEntity?.name || 'Select issuing entity'}</span>{selectedEntity?.address && <span className="paper-issuer-address">{selectedEntity.address}</span>}</div>{companyLogo && <img className="paper-company-logo" src={companyLogo} alt="Company logo" />}</div>
              <div className="paper-title-row"><h2>Commercial Proposal</h2></div>
              <div className="paper-document-meta">
                <div className="paper-meta-item"><span>ISSUE DATE</span><strong>{formatProposalDate(quote.date)}</strong></div>
                <div className="paper-meta-item"><span>QUOTE NUMBER</span><strong>{quoteNumber}</strong></div>
                <div className="paper-meta-item"><span>VALIDITY</span><strong>{formatProposalDate(quote.validUntil)}</strong></div>
              </div>
              <div className="paper-reference"><strong>Reference:</strong><span>{quoteType === 'product' ? 'Product' : 'Renewal'} - {quote.reference}</span></div>
              <div className="paper-rule" />
              <div className="paper-parties">
                <div className="paper-recipient"><strong>To,</strong>{quote.customer && <span>{quote.customer}</span>}{quote.customerCompany && <span>{quote.customerCompany}</span>}{quote.customerAddress && <span className="paper-address">{quote.customerAddress}</span>}</div>
              </div>
              <div className="paper-greeting"><p>Dear Sir/Madam,</p><p>Thank you very much for your interest in our products and services. Please find below the best offer as follows:</p></div>
              {quoteType === 'renewal' && <div className="paper-renewal"><span className="paper-label">RENEWAL COVERAGE</span><strong>{formatDate(quote.serviceStart)} – {formatDate(quote.serviceEnd)}</strong>{quote.contractReference && <span>Existing agreement: {quote.contractReference}</span>}</div>}
              <table className="paper-table">
                <thead><tr><th>DESCRIPTION</th><th>QTY</th><th>UNIT PRICE</th><th className="align-right">AMOUNT</th></tr></thead>
                <tbody>
                  {lineItems.length ? lineItems.map((item) => <tr key={item.id}><td><strong>{item.name || 'Untitled item'}</strong>{item.description && <small>{item.description}</small>}</td><td>{item.quantity}</td><td>{money(item.price, quote.currency)}</td><td className="align-right">{money(item.quantity * item.price, quote.currency)}</td></tr>) : <tr className="paper-empty-row"><td colSpan="4">Your selected items will appear here.</td></tr>}
                </tbody>
              </table>
              <div className="paper-summary">
                <div><span>Subtotal</span><strong>{money(totals.subtotal, quote.currency)}</strong></div>
                {Number(quote.discount) > 0 && <div><span>Discount ({quote.discount}%)</span><strong>−{money(totals.discount, quote.currency)}</strong></div>}
                {Number(quote.tax) > 0 && <div><span>Tax ({quote.tax}%)</span><strong>{money(totals.tax, quote.currency)}</strong></div>}
                <div className="paper-total"><span>Total due</span><strong>{money(totals.total, quote.currency)}</strong></div>
              </div>
              {quote.notes && <div className="paper-note"><span className="paper-label">A NOTE</span><p>{quote.notes}</p></div>}
              <div className="paper-footer"><span>{selectedEntity?.name || 'Issuing entity'}{quote.senderEmail ? ` · ${quote.senderEmail}` : ''}</span><span>Thank you for your consideration.</span></div>
            </article>
            <p className="preview-caption"><Check size={14} /> What you see here is what your customer receives.</p>
          </section>
        </div>
        <footer className="page-footer"><span>QUOTEGEN <i>·</i> COMMERCIAL PROPOSALS</span><span>Quote data stays in your browser.</span></footer>
      </main>
      {entityManagerOpen && <div className="entity-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEntityManagerOpen(false); }}>
        <section className="entity-dialog" role="dialog" aria-modal="true" aria-labelledby="entity-dialog-title">
          <div className="entity-dialog-header"><div><p className="eyebrow">QUOTE SETTINGS</p><h2 id="entity-dialog-title">Issuing entities</h2><p>Enter up to five entities. Their details will appear on quotes when selected.</p></div><button className="icon-button" type="button" title="Close" aria-label="Close entity settings" onClick={() => setEntityManagerOpen(false)}><X size={17} /></button></div>
          <div className="company-logo-setting">
            <label className="form-field"><span>Company logo <small>Shared by all five entities · PNG, JPEG, WebP, or GIF · up to 1 MB</small></span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleCompanyLogo} /></label>
            {companyLogoDraft && <div className="company-logo-preview"><img src={companyLogoDraft} alt="Company logo preview" /><button className="text-button" type="button" onClick={() => { setCompanyLogoDraft(''); setCompanyLogoError(''); }}>Remove logo</button></div>}
            {companyLogoError && <p className="form-error" role="alert">{companyLogoError}</p>}
          </div>
          <div className="entity-list">{entityDraft.map((entity, index) => <div className="entity-card" key={entity.id}>
            <div className="entity-card-heading"><span>ENTITY {index + 1}</span><span className={entity.name.trim() ? 'entity-status configured' : 'entity-status'}>{entity.name.trim() ? 'Configured' : 'Not set up'}</span></div>
            <label className="form-field"><span>Entity name</span><input value={entity.name} onChange={(event) => setEntityDraft((current) => current.map((entry) => entry.id === entity.id ? { ...entry, name: event.target.value } : entry))} placeholder={`Entity ${index + 1} legal name`} /></label>
            <label className="form-field"><span>Entity address</span><textarea rows="2" value={entity.address} onChange={(event) => setEntityDraft((current) => current.map((entry) => entry.id === entity.id ? { ...entry, address: event.target.value } : entry))} placeholder="Street, city, postal code, country" /></label>
          </div>)}</div>
          {entitySaveError && <p className="form-error" role="alert">{entitySaveError}</p>}
          <div className="entity-dialog-footer"><span>Saved in this browser only.</span><div><button className="button entity-cancel-button" type="button" onClick={() => setEntityManagerOpen(false)}>Cancel</button><button className="button button-dark" type="button" disabled={companyLogoReading} onClick={saveEntities}><Check size={15} /> {companyLogoReading ? 'Reading logo…' : 'Save entities'}</button></div></div>
        </section>
      </div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<QuoteWorkspace />);