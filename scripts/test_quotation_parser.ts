/**
 * Comprehensive Test Suite for ProcureLens Quotation Parser & Import Service
 */

import {
  detectDelimiter,
  parseCsvToRawRows,
  detectColumnMapping,
  cleanNumericString,
  parseNumeric,
  parseQualityRating,
  calculateQuotationItem,
  validateAndParseRow,
  checkDuplicates,
  groupItemsBySupplier,
  parseQuotationCsv,
  generateSampleQuotationCsv,
  type ColumnMapping,
} from '../src/lib/quotation-parser.ts'

import {
  saveQuotationsToDatabase,
} from '../src/services/quotation-import.service.ts'

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`)
    process.exit(1)
  }
  console.log(`✅ ${msg}`)
}

console.log('=== TEST SUITE: ProcureLens Quotation Intelligence ===\n')

// ---------------------------------------------------------------------------
// Test 1: Delimiter Detection & RFC 4180 Parsing
// ---------------------------------------------------------------------------
console.log('--- Test 1: RFC 4180 Parsing & Delimiter Detection ---')
const commaCsv = `Supplier,Product,Qty,Price\n"Acme, Inc.",Widget,10,100`
assert(detectDelimiter(commaCsv) === ',', 'Detects comma delimiter')

const semiCsv = `Supplier;Product;Qty;Price\nAcme;Widget;10;100`
assert(detectDelimiter(semiCsv) === ';', 'Detects semicolon delimiter')

const tabCsv = `Supplier\tProduct\tQty\tPrice\nAcme\tWidget\t10\t100`
assert(detectDelimiter(tabCsv) === '\t', 'Detects tab delimiter')

// Multiline & Escaped quotes in RFC 4180
const complexCsv = `"Supplier Name","Description","Quantity"\r\n"Mega ""Corp"" Ltd","Item with\nmultiline and ""quotes""",25`
const rawRows = parseCsvToRawRows(complexCsv, ',')
assert(rawRows.length === 2, 'Parsed 2 rows for multiline CSV')
assert(rawRows[1][0] === 'Mega "Corp" Ltd', 'Escaped quotes resolved properly')
assert(rawRows[1][1] === 'Item with\nmultiline and "quotes"', 'Multiline cell preserved')
assert(rawRows[1][2] === '25', 'Quantity parsed as 25')

// ---------------------------------------------------------------------------
// Test 2: Header Auto-Detection & Column Mapping
// ---------------------------------------------------------------------------
console.log('\n--- Test 2: Column Mapping & Alias Recognition ---')
const headers = [
  'Vendor Name',
  'Item Description',
  'Order Quantity',
  'Unit Rate (INR)',
  'Tax Rate %',
  'Freight Cost',
  'Lead Time (Days)',
  'Credit Terms',
  'Vendor Rating',
]
const mapping = detectColumnMapping(headers)
assert(mapping.supplierName === 0, 'Auto-detected supplierName column 0')
assert(mapping.productName === 1, 'Auto-detected productName column 1')
assert(mapping.quantity === 2, 'Auto-detected quantity column 2')
assert(mapping.unitPrice === 3, 'Auto-detected unitPrice column 3')
assert(mapping.gstPercentage === 4, 'Auto-detected gstPercentage column 4')
assert(mapping.deliveryCharges === 5, 'Auto-detected deliveryCharges column 5')
assert(mapping.deliveryDays === 6, 'Auto-detected deliveryDays column 6')
assert(mapping.paymentTerms === 7, 'Auto-detected paymentTerms column 7')
assert(mapping.qualityRating === 8, 'Auto-detected qualityRating column 8')

// Custom mapping override
const customMapping = detectColumnMapping(headers, { supplierName: 1, productName: 0 })
assert(customMapping.supplierName === 1, 'Custom mapping overrides supplierName to 1')
assert(customMapping.productName === 0, 'Custom mapping overrides productName to 0')

// ---------------------------------------------------------------------------
// Test 3: Normalization & Cleaning
// ---------------------------------------------------------------------------
console.log('\n--- Test 3: Data Normalization (Currency, Numbers, Ratings) ---')
assert(cleanNumericString('$1,250.50') === '1250.50', 'Cleans $ and comma')
assert(cleanNumericString('₹1,50,000.00') === '150000.00', 'Cleans Indian rupee symbol & numbering')
assert(cleanNumericString('€ 999.00') === '999.00', 'Cleans Euro')
assert(cleanNumericString('Rs. 450') === '450', 'Cleans Rs. prefix')
assert(cleanNumericString('18%') === '18', 'Strips % sign')
assert(parseNumeric('$45.50') === 45.5, 'Parses numeric 45.50')
assert(parseQualityRating('4.5 / 5') === 4.5, 'Parses rating "4.5 / 5"')
assert(parseQualityRating('★★★★') === 4, 'Parses star rating ★★★★')
assert(parseQualityRating('5') === 5, 'Parses rating "5"')

// ---------------------------------------------------------------------------
// Test 4: Accurate Financial Calculations
// ---------------------------------------------------------------------------
console.log('\n--- Test 4: Calculation Engine ---')
// Qty: 100, Unit Price: 45.50, GST: 18%, Delivery: 250
// Subtotal = 100 * 45.50 = 4550.00
// Tax = 4550 * 0.18 = 819.00
// Delivery = 250.00
// Total Cost = 4550 + 819 + 250 = 5619.00
// Effective unit cost = 5619 / 100 = 56.19
const calc = calculateQuotationItem(100, 45.50, 18, 250)
assert(calc.subtotal === 4550.00, `Subtotal correct: expected 4550, got ${calc.subtotal}`)
assert(calc.taxAmount === 819.00, `Tax correct: expected 819, got ${calc.taxAmount}`)
assert(calc.deliveryCharges === 250.00, `Delivery correct: expected 250, got ${calc.deliveryCharges}`)
assert(calc.totalCost === 5619.00, `Total cost correct: expected 5619, got ${calc.totalCost}`)
assert(calc.effectiveUnitCost === 56.19, `Effective unit cost correct: expected 56.19, got ${calc.effectiveUnitCost}`)

// ---------------------------------------------------------------------------
// Test 5: Row Validation Rules
// ---------------------------------------------------------------------------
console.log('\n--- Test 5: Validation Rules (Errors & Warnings) ---')
const testHeaders = ['Supplier', 'Product', 'Quantity', 'Unit Price', 'GST %', 'Delivery Charges', 'Delivery Days', 'Rating']
const testMap: ColumnMapping = {
  supplierName: 0,
  productName: 1,
  quantity: 2,
  unitPrice: 3,
  gstPercentage: 4,
  deliveryCharges: 5,
  deliveryDays: 6,
  paymentTerms: null,
  qualityRating: 7,
}

// Invalid Row: Quantity = -5, Unit Price = -10, GST = 150%, Rating = 10
const invalidRow = ['Vendor X', 'Part Y', '-5', '-10', '150%', '-50', '-3', '10']
const resInvalid = validateAndParseRow(invalidRow, testHeaders, testMap, 2, 0)
assert(!resInvalid.isValid, 'Row marked invalid with negative / out-of-range values')
assert(resInvalid.errors.some((e) => e.field === 'quantity'), 'Error reported for quantity')
assert(resInvalid.errors.some((e) => e.field === 'unitPrice'), 'Error reported for unitPrice')
assert(resInvalid.errors.some((e) => e.field === 'gstPercentage'), 'Error reported for gstPercentage')
assert(resInvalid.errors.some((e) => e.field === 'deliveryCharges'), 'Error reported for deliveryCharges')
assert(resInvalid.errors.some((e) => e.field === 'deliveryDays'), 'Error reported for deliveryDays')
assert(resInvalid.errors.some((e) => e.field === 'qualityRating'), 'Error reported for qualityRating')

// Valid Row
const validRow = ['Acme Supplies', 'Hex Bolt M8', '500', '3.50', '18%', '50', '5', '4.5']
const resValid = validateAndParseRow(validRow, testHeaders, testMap, 3, 1)
assert(resValid.isValid, 'Valid row is marked valid')
assert(resValid.calculated?.subtotal === 1750, 'Subtotal: 500 * 3.5 = 1750')
assert(resValid.calculated?.taxAmount === 315, 'Tax: 1750 * 0.18 = 315')
assert(resValid.calculated?.totalCost === 2115, 'Total: 1750 + 315 + 50 = 2115')

// ---------------------------------------------------------------------------
// Test 6: Intra-file Duplicate Detection
// ---------------------------------------------------------------------------
console.log('\n--- Test 6: Duplicate Detection ---')
const duplicateRows = [
  validateAndParseRow(['Acme', 'Bearing A', '10', '100', '0', '0', '5', '4'], testHeaders, testMap, 2, 0),
  validateAndParseRow(['Acme', 'Bearing A', '20', '95', '0', '0', '5', '4'], testHeaders, testMap, 3, 1),
]
checkDuplicates(duplicateRows, [], false)
assert(duplicateRows[0].isValid, 'First occurrence is valid')
assert(!duplicateRows[1].isValid, 'Second occurrence of same item for Acme marked duplicate error')
assert(duplicateRows[1].isDuplicate === true, 'Duplicate flag set')

// ---------------------------------------------------------------------------
// Test 7: Full CSV Parsing & Supplier Grouping
// ---------------------------------------------------------------------------
console.log('\n--- Test 7: Full End-to-End CSV Parser & Aggregation ---')
const sampleCsv = generateSampleQuotationCsv()
const parseResult = parseQuotationCsv(sampleCsv)
assert(parseResult.totalRows === 5, `Parsed 5 data rows (got ${parseResult.totalRows})`)
assert(parseResult.validRows.length === 5, 'All 5 rows valid')
assert(parseResult.supplierGroups.length === 3, 'Grouped into 3 unique suppliers')

const acmeGroup = parseResult.supplierGroups.find((g) => g.supplierName.includes('Acme'))
assert(Boolean(acmeGroup), 'Acme group found')
assert(acmeGroup!.items.length === 2, 'Acme has 2 line items')
// Item 1: 100 * 45.50 = 4550 + 819 tax + 250 del = 5619
// Item 2: 500 * 3.20 = 1600 + 288 tax + 0 del = 1888
// Total Acme = 5619 + 1888 = 7507
assert(acmeGroup!.totalQuotationCost === 7507, `Acme total cost expected 7507, got ${acmeGroup!.totalQuotationCost}`)

// ---------------------------------------------------------------------------
// Test 8: Database Save Helper (DeepSpace DB Simulation)
// ---------------------------------------------------------------------------
console.log('\n--- Test 8: DeepSpace DB Save Service ---')
const mockQuotationsStore: any[] = []
const mockItemsStore: any[] = []
const mockSuppliersStore: any[] = []

const mockMutations = {
  quotations: {
    create: async (data: any) => {
      const id = `quot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      mockQuotationsStore.push({ id, ...data })
      return id
    },
  },
  quotationItems: {
    create: async (data: any) => {
      const id = `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      mockItemsStore.push({ id, ...data })
      return id
    },
  },
  suppliers: {
    create: async (data: any) => {
      const id = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      mockSuppliersStore.push({ id, ...data })
      return id
    },
  },
}

async function testSaveService() {
  const saveResult = await saveQuotationsToDatabase({
    organizationId: 'org_enterprise_123',
    purchaseRequestId: 'pr_bearings_001',
    validRows: parseResult.validRows,
    mutations: mockMutations,
    autoCreateSuppliers: true,
  })

  assert(saveResult.success, 'Save quotations succeeded')
  assert(saveResult.totalQuotationsCreated === 3, `Created 3 parent quotations (got ${saveResult.totalQuotationsCreated})`)
  assert(saveResult.totalItemsCreated === 5, `Created 5 quotation items (got ${saveResult.totalItemsCreated})`)
  assert(mockQuotationsStore.length === 3, '3 records in quotations collection')
  assert(mockItemsStore.length === 5, '5 records in quotation_items collection')

  // Verify multi-tenant org stamp
  for (const q of mockQuotationsStore) {
    assert(q.organizationId === 'org_enterprise_123', 'Parent quotation stamped with active organizationId')
    assert(q.purchaseRequestId === 'pr_bearings_001', 'Parent quotation stamped with purchaseRequestId')
  }
  for (const item of mockItemsStore) {
    assert(item.organizationId === 'org_enterprise_123', 'Child item stamped with active organizationId')
    assert(Boolean(item.quotationId), 'Child item linked to parent quotationId')
  }
  console.log('✅ DeepSpace database multi-tenant persistence verified!')
}

await testSaveService()

console.log('\n======================================================')
console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! MANDATE COMPLETE.')
console.log('======================================================\n')
