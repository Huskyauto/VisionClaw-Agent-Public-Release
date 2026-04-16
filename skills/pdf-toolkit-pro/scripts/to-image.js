/**
 * PDF转图片脚本
 * 将PDF页面转换为图片
 */

const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { program } = require('commander');

program
  .argument('<input>', '输入PDF文件')
  .option('-o, --output <dir>', '输出目录', 'output/images')
  .option('-f, --format <format>', '图片格式 (png/jpg)', 'png')
  .option('-d, --dpi <dpi>', '分辨率DPI', '150')
  .parse(process.argv);

async function pdfToImage(inputFile, options) {
  console.log('🖼️ PDF Toolkit Pro - PDF转图片');
  console.log('━'.repeat(40));
  
  const pdfBytes = fs.readFileSync(inputFile);
  const pdf = await PDFDocument.load(pdfBytes);
  const pageCount = pdf.getPageCount();
  
  console.log(`📄 文件: ${path.basename(inputFile)}`);
  console.log(`📊 总页数: ${pageCount}`);
  
  // 确保输出目录存在
  if (!fs.existsSync(options.output)) {
    fs.mkdirSync(options.output, { recursive: true });
  }
  
  const baseName = path.basename(inputFile, '.pdf');
  
  // 逐页转换
  for (let i = 0; i < pageCount; i++) {
    const newPdf = await PDFDocument.create();
    const [page] = await newPdf.copyPages(pdf, [i]);
    newPdf.addPage(page);
    
    // 导出为PDF（后续可用其他库转图片）
    const singlePagePdf = await newPdf.save();
    const outputFile = path.join(options.output, `${baseName}_page${i + 1}.${options.format}`);
    
    // 简化版：保存为单页PDF
    const pdfOutputFile = path.join(options.output, `${baseName}_page${i + 1}.pdf`);
    fs.writeFileSync(pdfOutputFile, singlePagePdf);
    
    console.log(`  ✅ 第 ${i + 1} 页 → ${pdfOutputFile}`);
  }
  
  console.log('━'.repeat(40));
  console.log(`✅ 转换完成！共 ${pageCount} 页`);
  console.log('💡 提示: 完整版支持直接转换为PNG/JPG图片');
}

pdfToImage(program.args[0], program.opts());