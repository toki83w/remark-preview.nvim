// Prints a page to PDF with headless Chrome (puppeteer).
//   node export.js <url> <output.pdf>
// Environment: PDF_FORMAT (default A4), PDF_MARGIN (default 1cm).
// Exit codes: 0 done, 1 failed (the reason is on stderr), 3 puppeteer is not installed.
const [url, pdfPath] = process.argv.slice(2);
const pdfFormat = process.env.PDF_FORMAT || "A4";
const pdfMargin = process.env.PDF_MARGIN || "1cm";

if (!url || !pdfPath) {
  console.error("usage: export.js <url> <output.pdf>");
  process.exit(1);
}

let puppeteer;
try {
  puppeteer = (await import("puppeteer")).default;
} catch {
  console.error("puppeteer is not installed, run :RemarkPreviewInstallDeps");
  process.exit(3);
}

let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  const response = await page.goto(url, { waitUntil: ["networkidle2", "load"], timeout: 60000 });
  if (!response || !response.ok()) {
    const body = response ? (await response.text()).trim().slice(0, 300) : "no response";
    throw new Error(`the page answered ${response ? response.status() : "nothing"}: ${body}`);
  }

  await page.pdf({
    path: pdfPath,
    format: pdfFormat,
    printBackground: true,
    margin: {
      top: pdfMargin,
      right: pdfMargin,
      bottom: pdfMargin,
      left: pdfMargin,
    },
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `
                <div style="font-family: Arial, sans-serif; font-size: 10px; width: 100%; text-align: center; color: #666;">
                    Page <span class="pageNumber"></span> of <span class="totalPages"></span>
                </div>`,
  });
  await browser.close();
  process.exit(0);
} catch (e) {
  console.error(e && e.message ? e.message : String(e));
  if (browser) {
    await browser.close().catch(() => {});
  }
  process.exit(1);
}
