# QuoteGenUtility

QuoteGenUtility is a browser-based commercial proposal tool. Import a product or service catalog from Excel, add items to a quote, enter customer details, and print the finished quote or save it as a PDF.

Choose between a Product Quote and an AMC / Renewal Quote. Renewal quotes include a service coverage period and an optional existing agreement reference.

Use **Manage entities** in the quote form to enter up to five issuing entity names and addresses. You can also add one shared company logo, which appears on proposals for any selected entity. Entity details and the logo are saved in this browser.

Enter reference details in the quote form; the proposal prefixes them with **Product -** or **Renewal -** based on the quote type. Proposal numbers are generated in sequence as `TECS-<first four alphanumeric characters of person name>-DDMMYYYY-<six-character sequence>`. The sequence is stored in this browser, so it is shared by its quotes and does not synchronize across browsers or devices.

The printed proposal centers the heading and shows the recipient's person name, company, and address under **To,**, followed by the standard greeting.

## Run locally

```bash
npm install
npm start
```

The app runs on http://localhost:5173 by default.

## Publish

Pushing to `main` builds and deploys the site to [GitHub Pages](https://nkumarsingh6262.github.io/QuoteGenUtility/). The workflow can also be started manually from the repository's Actions tab.

The workbook is processed in the browser and is not uploaded to a server. The first worksheet row should contain column headers; during import, choose the columns for item name and unit price. `.xlsx` and `.csv` files are supported.

Use the sample catalog to explore the quote workflow without an Excel file. The print action opens the browser's print dialog, where the quote can be printed or saved as a PDF.
