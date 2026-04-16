/**
 * PDF分割脚本
 * 将PDF分割成多个文件
 */

const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { program } = require('commander');

program
  .argument('<input>', '输入PDF文件')
  .option('-p, --pages <range>', '页面范围（如 1-5 或 1,3,5）')
  .option('--each', '每页单独保存')
  .option('-o, --output <dir>', '输出目录', 'output')
  .parse(process.argv);

function parsePageRange(range, totalPages) {
  if (!range) return Array.from({ length: totalPages }, (_, i) => i);
  
  const pages = [];
  const parts = range.split(',');
  
  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n.trim()));
      for (let i = start; i <= end; i++) {
        pages.push(i - 1);
      }
    } else {
      pages.push(parseInt(part.trim()) - 1);
    }
  }
  
  return pages.filter(p => p >= 0 && p < totalPages);
}

async function splitPDF(inputFile, options) {
  console.log('✂️ PDF Toolkit Pro - 分割PDF');
  console.log('━'.repeat(40));
  
  const pdfBytes = fs.readFileSync(inputFile);
  const pdf = await PDFDocument.load(pdfBytes);
  const totalPages = pdf.getPageCount();
  
  console.log(`📄 文件: ${path.basename(inputFile)}`);
  console.log(`📊 总页数: ${totalPages}`);
  
  // 确保输出目录存在
  if (!fs.existsSync(options.output)) {
    fs.mkdirSync(options.output, { recursive: true });
  }
  
  const baseName = path.basename(inputFile, '.pdf');
  
  if (options.each) {
    // 每页单独保存
    for (let i = 0; i < totalPages; i++) {
      const newPdf = await PDFDocument.create();
      const [page] = await newPdf.copyPages(pdf, [i]);
      newPdf.addPage(page);
      
      const outputFile = path.join(options.output, `${baseName}_page${i + 1}.pdf`);
      fs.writeFileSync(outputFile, await newPdf.save());
      console.log(`  ✅ 第 ${i + 1} 页 → ${outputFile}`);
    }
  } else {
    // 按范围提取
    const pages = parsePageRange(options.pages, totalPages);
    
    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(pdf, pages);
    copiedPages.forEach(page => newPdf.addPage(page));
    
    const outputFile = path.join(options.output, `${baseName}_split.pdf`);
    fs.writeFileSync(outputFile, await newPdf.save());
    console.log(`  ✅ 提取 ${pages.length} 页 → ${outputFile}`);
  }
  
  console.log('━'.repeat(40));
  console.log('✅ 分割完成！');
}

splitPDF(program.args[0], program.opts());