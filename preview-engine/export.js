import puppeteer from "puppeteer";

(async () => {
  const htmlPath = process.argv[2];
  const pdfPath = process.argv[3];
  const pdfFormat = process.env.PDF_FORMAT || "A4";
  const pdfMargin = process.env.PDF_MARGIN || "1cm";

  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    // Load the local temp HTML
    await page.goto(`file://${htmlPath}`, {
      waitUntil: ["networkidle2", "load"],
    });

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
    console.error(e);
    process.exit(1);
  }
})();
