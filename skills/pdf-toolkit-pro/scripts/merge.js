/**
 * PDF合并脚本
 * 将多个PDF文件合并成一个
 */

const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const { program } = require('commander');

program
  .argument('<input>', '输入PDF文件（支持通配符）')
  .option('-o, --output <file>', '输出文件路径', 'merged.pdf')
  .parse(process.argv);

async function mergePDFs(inputPattern, outputFile) {
  console.log('📄 PDF Toolkit Pro - 合并PDF');
  console.log('━'.repeat(40));
  
  // 查找匹配的文件
  const files = glob.sync(inputPattern);
  
  if (files.length === 0) {
    console.error('❌ 未找到匹配的PDF文件');
    process.exit(1);
  }
  
  console.log(`📂 找到 ${files.length} 个文件`);
  
  // 创建新PDF
  const mergedPdf = await PDFDocument.create();
  
  // 逐个合并
  for (const file of files) {
    console.log(`  📎 ${path.basename(file)}`);
    const pdfBytes = fs.readFileSync(file);
    const pdf = await PDFDocument.load(pdfBytes);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    pages.forEach(page => mergedPdf.addPage(page));
  }
  
  // 保存
  const mergedPdfBytes = await mergedPdf.save();
  
  // 确保输出目录存在
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(outputFile, mergedPdfBytes);
  
  console.log('━'.repeat(40));
  console.log(`✅ 合并完成！输出: ${outputFile}`);
  console.log(`📊 总页数: ${mergedPdf.getPageCount()}`);
}

mergePDFs(program.args[0], program.opts().output);