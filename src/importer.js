function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = text(value).replace(/[,$\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateInput(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  const raw = text(value);
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const renewal = raw.match(/^(\d{1,2})\/([a-z]{3})\/(\d{4})$/i);
  if (renewal) {
    const month = new Date(`${renewal[2]} 1, 2000 UTC`).getUTCMonth() + 1;
    return `${renewal[3]}-${String(month).padStart(2, '0')}-${renewal[1].padStart(2, '0')}`;
  }
  const named = raw.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (named) {
    const month = new Date(`${named[1]} 1, 2000 UTC`).getUTCMonth() + 1;
    return `${named[3]}-${String(month).padStart(2, '0')}-${named[2].padStart(2, '0')}`;
  }
  return '';
}

function addDays(value, count) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return dateInput(date);
}

function metadataFrom(rows) {
  const metadata = {};
  for (const row of rows) {
    const key = normalize(row[1]);
    const value = text(row[2]);
    if (key && value) metadata[key] = value;
  }
  return metadata;
}

function typeFor(headers, vendor, sheetName) {
  const has = (...names) => names.some((name) => headers.includes(name));
  const source = normalize(vendor || sheetName);

  if (has('previouscontractnumber') && has('renewstart') && has('renewend') && has('unitmsrp')) {
    return 'audiocodes-renewal';
  }
  if (has('systemnumbergroup') && has('servicepartnumber') && has('extendednetprice') && has('extendedlistprice')) {
    return source.includes('enghouse') ? 'enghouse-renewal' : 'ribbon-renewal';
  }
  if (has('qty') && has('enghousesku') && has('itemname') && has('productdescription') && has('partnerdiscountedunitpriceusd')) {
    return 'enghouse-product';
  }
  if (has('item', 'itemname') && has('itemdescription') && has('quantity', 'qty') && has('netpriceusd', 'netprice', 'listpriceusd')) {
    return source.includes('audiocodes') ? 'audiocodes-product' : 'ribbon-product';
  }
  return '';
}

function valueFor(row, headers, ...aliases) {
  const index = headers.findIndex((header) => aliases.includes(header));
  return index < 0 ? '' : row[index];
}

function sectionName(rows, headerIndex) {
  const row = rows[headerIndex - 1] ?? [];
  const label = row.map(text).find((cell) => /^(configuration|system number group)\s*:/i.test(cell));
  return label ? label.split(':').slice(1).join(':').trim() : '';
}

function lineFromRow(type, row, headers, section) {
  if (/^add another configuration heading/i.test(row.map(text).join(' ').trim())) return null;
  const hasItemData = row.some((value, index) => {
    const cell = text(value);
    return cell
      && !['quantity', 'qty'].includes(headers[index])
      && !['maingroup', 'mainconfiguration', 'maincontract'].includes(normalize(cell));
  });
  if (!hasItemData) return null;

  const quantity = amount(valueFor(row, headers, 'quantity', 'qty'));
  const missing = [];
  if (quantity == null || quantity <= 0) missing.push('positive quantity');

  let sku = '';
  let name = '';
  let description = '';
  let rawPrice = null;
  let isLineTotal = false;

  if (type.endsWith('-product') && type !== 'enghouse-product') {
    sku = text(valueFor(row, headers, 'item'));
    name = sku;
    description = text(valueFor(row, headers, 'itemdescription'));
    if (!name) missing.push('item');
    if (!description) missing.push('item description');
    rawPrice = amount(valueFor(row, headers, 'netpriceusd', 'netprice'));
    if (rawPrice == null) rawPrice = amount(valueFor(row, headers, 'listpriceusd'));
  } else if (type === 'enghouse-product') {
    sku = text(valueFor(row, headers, 'enghousesku'));
    name = text(valueFor(row, headers, 'itemname')) || sku;
    description = text(valueFor(row, headers, 'productdescription'));
    if (!name) missing.push('Enghouse SKU or item name');
    if (!description) missing.push('product description');
    rawPrice = amount(valueFor(row, headers, 'specialdiscountedunitprice'));
    if (rawPrice == null) rawPrice = amount(valueFor(row, headers, 'partnerdiscountedunitpriceusd'));
    if (rawPrice == null) {
      rawPrice = amount(valueFor(row, headers, 'extendedpriceusd'));
      isLineTotal = rawPrice != null;
    }
  } else if (type === 'audiocodes-renewal') {
    sku = text(valueFor(row, headers, 'partnumber', 'servicepart'));
    const contractReference = text(valueFor(row, headers, 'previouscontractnumber'));
    const coverage = text(valueFor(row, headers, 'coverageprogram'));
    const productDescription = text(valueFor(row, headers, 'productdescription'));
    name = coverage || productDescription || sku;
    description = [coverage, productDescription].filter(Boolean).join(' · ');
    if (!contractReference) missing.push('previous contract number');
    if (!text(valueFor(row, headers, 'partnumber'))) missing.push('part number');
    if (!dateInput(valueFor(row, headers, 'renewstart'))) missing.push('renewal start date');
    if (!dateInput(valueFor(row, headers, 'renewend'))) missing.push('renewal end date');
    rawPrice = amount(valueFor(row, headers, 'unitmsrp'));
    isLineTotal = true;
  } else {
    sku = text(valueFor(row, headers, 'servicepartnumber', 'servicepart'));
    const group = text(valueFor(row, headers, 'systemnumbergroup'));
    const serviceDescription = text(valueFor(row, headers, 'servicedescription'));
    const product = text(valueFor(row, headers, 'product'));
    const productDescription = text(valueFor(row, headers, 'productdescription'));
    name = serviceDescription || productDescription || sku || product;
    description = [product, productDescription].filter(Boolean).join(' · ');
    if (!group) missing.push('system number group');
    if (!text(valueFor(row, headers, 'servicepartnumber'))) missing.push('service part number');
    if (!serviceDescription) missing.push('service description');
    if (!product) missing.push('product');
    rawPrice = amount(valueFor(row, headers, 'extendednetprice'));
    if (rawPrice == null) rawPrice = amount(valueFor(row, headers, 'extendedlistprice'));
    isLineTotal = true;
  }

  if (rawPrice == null || rawPrice < 0) missing.push('price');
  if (missing.length) return { error: [...new Set(missing)].join(', ') };
  const price = isLineTotal ? rawPrice / quantity : rawPrice;
  if (section) description = [section, description].filter(Boolean).join(' · ');

  return {
    item: {
      sku,
      name,
      description,
      category: type,
      quantity,
      price,
      serviceStart: dateInput(valueFor(row, headers, 'servicestartdate', 'renewstart')),
      serviceEnd: dateInput(valueFor(row, headers, 'serviceenddate', 'renewend')),
      contractReference: text(valueFor(row, headers, 'previouscontractnumber')),
    },
  };
}

export function parseQuoteWorkbook(sheets) {
  const tables = [];
  for (const sheet of sheets) {
    const metadata = metadataFrom(sheet.rows);
    const vendor = metadata.vendor || '';
    for (const [index, row] of sheet.rows.entries()) {
      const headers = row.map(normalize);
      const type = typeFor(headers, vendor, sheet.name);
      if (type) tables.push({ sheet, index, headers, type, metadata, section: sectionName(sheet.rows, index) });
    }
  }
  if (!tables.length) return null;

  const items = [];
  const invalidRows = [];
  const populatedTypes = new Set();
  const importedMetadata = {};
  for (const table of tables) {
    const nextHeader = tables.find((candidate) => candidate.sheet === table.sheet && candidate.index > table.index)?.index ?? table.sheet.rows.length;
    for (const [offset, row] of table.sheet.rows.slice(table.index + 1, nextHeader).entries()) {
      const parsed = lineFromRow(table.type, row, table.headers, table.section);
      if (parsed?.error) {
        invalidRows.push(`${table.sheet.name} row ${table.index + offset + 2}: ${parsed.error}`);
      } else if (parsed?.item) {
        const item = parsed.item;
        items.push(item);
        populatedTypes.add(table.type);
        importedMetadata.serviceStart ||= item.serviceStart;
        importedMetadata.serviceEnd ||= item.serviceEnd;
        importedMetadata.contractReference ||= item.contractReference;
      }
    }
    if (table.metadata.endcustomer) importedMetadata.customerCompany ||= table.metadata.endcustomer;
    if (table.metadata.quotenumber) importedMetadata.reference ||= table.metadata.quotenumber;
    if (table.metadata.vendor) importedMetadata.vendor ||= table.metadata.vendor;
  }

  if (invalidRows.length) {
    return { error: `Complete the required fields in these rows: ${invalidRows.slice(0, 4).join('; ')}.` };
  }
  const quoteTypes = new Set([...populatedTypes].map((type) => type.endsWith('renewal') ? 'renewal' : 'product'));
  if (quoteTypes.size > 1) {
    return { error: 'This workbook contains both product and renewal items. Upload one quote type at a time.' };
  }
  if (!items.length) {
    return { error: 'A supported quote format was detected, but no complete item rows were found.' };
  }
  return { items, quoteType: [...quoteTypes][0], metadata: importedMetadata };
}

export function parseEnghouseRenewalPdf(pdfItems) {
  const entries = pdfItems.flatMap((item) => {
    const value = text(item.str);
    const x = Number(item.x ?? item.transform?.[4]);
    const y = Number(item.y ?? item.transform?.[5]);
    return value && Number.isFinite(x) && Number.isFinite(y) ? [{ value, x, y: Math.round(y) }] : [];
  });
  if (!entries.length) return { error: 'This PDF contains no selectable text. Upload a searchable Enghouse renewal quotation.' };

  const grouped = new Map();
  for (const entry of entries) {
    const line = grouped.get(entry.y) ?? [];
    line.push(entry);
    grouped.set(entry.y, line);
  }
  const lines = [...grouped].map(([y, parts]) => ({
    y,
    parts: parts.sort((left, right) => left.x - right.x),
  }));
  const allText = entries.map((entry) => entry.value).join(' ');
  const tableHeader = lines.find(({ parts }) => {
    const header = normalize(parts.map((part) => part.value).join(' '));
    return header.includes('qty') && header.includes('part') && header.includes('description') && header.includes('price') && header.includes('extprice');
  });
  if (!tableHeader) return { error: 'This PDF does not match the supported Enghouse renewal quotation layout.' };

  const headerColumn = (pattern) => tableHeader.parts.find((part) => pattern.test(part.value));
  const qtyColumn = headerColumn(/^qty$/i);
  const partColumn = headerColumn(/^part\s*#$/i);
  const descriptionColumn = headerColumn(/^description$/i);
  const priceColumn = headerColumn(/^price$/i);
  const extendedColumn = headerColumn(/^ext\s*price/i);
  if (!qtyColumn || !partColumn || !descriptionColumn || !priceColumn || !extendedColumn) {
    return { error: 'The Enghouse renewal price table is missing a required column.' };
  }

  const itemRows = [];
  const tableLines = lines.filter(({ y }) => y < tableHeader.y && y > tableHeader.y - 260);
  for (const line of tableLines) {
    const sku = line.parts.find((part) => part.x >= partColumn.x - 8
      && part.x < descriptionColumn.x - 10
      && /[a-z]/i.test(part.value)
      && /\d/.test(part.value));
    if (!sku) continue;

    const quantity = line.parts.find((part) => part.x < partColumn.x - 8 && /^\d+(?:\.\d+)?$/.test(part.value));
    const price = line.parts.find((part) => part.x >= priceColumn.x - 18
      && part.x < extendedColumn.x - 18
      && amount(part.value) != null);
    const extendedPrice = line.parts.find((part) => part.x >= extendedColumn.x - 18 && amount(part.value) != null);
    const descriptionParts = entries.filter((entry) => entry.x >= descriptionColumn.x - 10
      && entry.x < priceColumn.x - 10
      && entry.y >= line.y
      && entry.y <= line.y + 45
      && !/(?:\d{1,2}\/[a-z]{3}\/\d{4}|previous\s+contract|serial\s+number)/i.test(entry.value));
    const nearestDescription = Math.min(...descriptionParts.map((entry) => entry.y - line.y));
    const description = descriptionParts
      .filter((entry) => entry.y - line.y <= nearestDescription + 14)
      .sort((left, right) => right.y - left.y || left.x - right.x)
      .map((entry) => entry.value)
      .join(' ')
      .trim();
    const count = amount(quantity?.value);
    const unitPrice = amount(price?.value) ?? (amount(extendedPrice?.value) != null && count ? amount(extendedPrice.value) / count : null);
    const missing = [];
    if (!count || count <= 0) missing.push('quantity');
    if (!description) missing.push('description');
    if (unitPrice == null || unitPrice < 0) missing.push('price');
    if (missing.length) {
      itemRows.push({ error: `The item row is missing ${missing.join(', ')}.` });
    } else {
      itemRows.push({
        item: {
          sku: sku.value,
          name: description,
          description,
          category: 'enghouse-renewal',
          quantity: count,
          price: unitPrice,
        },
      });
    }
  }
  if (!itemRows.length) return { error: 'No Enghouse renewal line items were found in this PDF.' };
  const invalidItem = itemRows.find((row) => row.error);
  if (invalidItem) return { error: invalidItem.error };

  const labelValue = (pattern, maxX = 450) => {
    for (const line of lines) {
      const label = line.parts.find((part) => pattern.test(part.value) && part.x < maxX);
      if (!label) continue;
      return line.parts.find((part) => part.x > label.x && part.x < maxX)?.value ?? '';
    }
    return '';
  };
  const emails = entries.filter((entry) => /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(entry.value));
  const issueDateText = labelValue(/^date\s*:/i, 450);
  const issueDate = dateInput(issueDateText);
  const servicePeriod = allText.match(/(\d{1,2}\/[a-z]{3}\/\d{4})\s*[-–]\s*(\d{1,2}\/[a-z]{3}\/\d{4})/i);
  const quoteNumber = labelValue(/^quote\s*#\s*:/i, 750);
  const previousContract = allText.match(/previous\s+contract\s*#\s*([a-z0-9_-]+)/i);
  const validity = allText.match(/valid\s+for\s+(\d+)\s+days\s+from\s+the\s+date\s+of\s+quotation/i);
  const serviceStart = dateInput(servicePeriod?.[1]);
  const serviceEnd = dateInput(servicePeriod?.[2]);

  return {
    items: itemRows.map((row) => row.item),
    quoteType: 'renewal',
    metadata: {
      customerCompany: labelValue(/^company\s*:/i),
      customer: labelValue(/^name\s*:/i),
      customerEmail: emails.find((entry) => entry.x < 450)?.value ?? '',
      senderEmail: emails.find((entry) => entry.x >= 450)?.value ?? '',
      reference: quoteNumber,
      contractReference: previousContract?.[1] ?? '',
      date: issueDate,
      validUntil: validity && issueDate ? addDays(issueDate, Number(validity[1])) : '',
      serviceStart,
      serviceEnd,
      currency: 'USD',
    },
  };
}