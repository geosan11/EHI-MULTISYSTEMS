const fs = require('fs');

let content = fs.readFileSync('src/components/views/Analytics.tsx', 'utf8');

// Find the metrics useMemo block
const metricsRegex = /const metrics = useMemo\(\(\) => \{[\s\S]*?return \{[\s\S]*?\};\n  \}, \[periodFilteredTxs, airlineCommissions\]\);/;

const newMetrics = `const metrics = useMemo(() => {
    const cargo = periodFilteredTxs.filter(t => t.type === 'cargo');
    const baggage = periodFilteredTxs.filter(t => t.type === 'baggage');
    const marketing = periodFilteredTxs.filter(t => t.type === 'marketing');
    const packages = periodFilteredTxs.filter(t => t.type === 'package');

    // Identify non-liquid/non-revenue transactions
    const debtTxs = periodFilteredTxs.filter(t => t.mode === 'Debt');
    const officeWorkTxs = debtTxs.filter(t => t.clientType === 'Office Work');
    const individualDebtTxs = debtTxs.filter(t => t.clientType !== 'Office Work');
    const retrievedTxs = periodFilteredTxs.filter(t => t.retrieved === true);

    // Liquid Transactions (The actual real money we can count as Revenue)
    // We also consider 'is_debt_clearance' as liquid since it's money coming in today for past debts!
    const validLiquidTxs = periodFilteredTxs.filter(t => (t.mode !== 'Debt' && !t.retrieved) || t.is_debt_clearance);

    const totalRevenue = validLiquidTxs.reduce((sum, t) => sum + t.amount, 0); // Pure liquid
    const cargoRevenue = validLiquidTxs.filter(t => t.type === 'cargo').reduce((sum, t) => sum + t.amount, 0);
    const baggageRevenue = validLiquidTxs.filter(t => t.type === 'baggage').reduce((sum, t) => sum + t.amount, 0);
    const marketingRevenue = validLiquidTxs.filter(t => t.type === 'marketing').reduce((sum, t) => sum + t.amount, 0);
    const packagesRevenue = validLiquidTxs.filter(t => t.type === 'package').reduce((sum, t) => sum + t.amount, 0);

    const grossVolumeValue = periodFilteredTxs.reduce((sum, t) => sum + t.amount, 0);

    const totalKg = periodFilteredTxs.reduce((sum, t) => sum + (t.kg || 0), 0);
    const cargoKg = cargo.reduce((sum, t) => sum + (t.kg || 0), 0);
    const baggageKg = baggage.reduce((sum, t) => sum + (t.kg || 0), 0);

    const totalPcs = periodFilteredTxs.reduce((sum, t) => sum + (t.pieces || 1), 0);
    const totalWaybills = periodFilteredTxs.length;

    // Unit Economics Metrics
    const avgYieldPerKg = totalKg > 0 ? totalRevenue / totalKg : 0;
    const avgRevenuePerShipment = totalWaybills > 0 ? totalRevenue / totalWaybills : 0;

    // Payment Collection Breakdown
    const cashRevenue = periodFilteredTxs.filter(t => t.mode === 'Cash').reduce((sum, t) => sum + t.amount, 0);
    const transferRevenue = periodFilteredTxs.filter(t => t.mode === 'Transfer').reduce((sum, t) => sum + t.amount, 0);
    const posRevenue = periodFilteredTxs.filter(t => t.mode === 'POS').reduce((sum, t) => sum + t.amount, 0);
    const walletDeductions = periodFilteredTxs.reduce((sum, t) => sum + (t.wallet_deduction_amount || (t.mode === 'Wallet' ? t.amount : 0)), 0);
    const debtOutstanding = debtTxs.reduce((sum, t) => sum + t.amount, 0);
    const officeWorkValue = officeWorkTxs.reduce((sum, t) => sum + t.amount, 0);
    const retrievedValue = retrievedTxs.reduce((sum, t) => sum + t.amount, 0);

    const unconfirmedTransfers = periodFilteredTxs.filter(t => t.mode === 'Transfer' && !t.paymentConfirmed).reduce((sum, t) => sum + t.amount, 0);
    const unverifiedCash = periodFilteredTxs.filter(t => t.mode === 'Cash' && !t.paymentConfirmed).reduce((sum, t) => sum + t.amount, 0);

    const totalCollected = cashRevenue + transferRevenue + posRevenue + walletDeductions - unconfirmedTransfers - unverifiedCash;
    const collectionEfficiency = totalRevenue > 0 ? Math.min(100, Math.round((totalCollected / totalRevenue) * 100)) : 100;

    // Airline Payables (remittance)
    const airlinePayables = cargo.reduce((sum, t) => {
      if (!t.airline) return sum;
      const normalizedAirline = normalizeAirlineName(t.airline);
      const commRate = t.commissionRate ?? airlineCommissions[normalizedAirline] ?? 0;
      return sum + (t.amount * (1 - commRate / 100));
    }, 0);

    return {
      totalRevenue,
      grossVolumeValue,
      cargoRevenue,
      baggageRevenue,
      marketingRevenue,
      packagesRevenue,
      totalKg,
      cargoKg,
      baggageKg,
      totalPcs,
      totalWaybills,
      avgYieldPerKg,
      avgRevenuePerShipment,
      cashRevenue,
      transferRevenue,
      posRevenue,
      walletDeductions,
      debtOutstanding,
      officeWorkValue,
      retrievedValue,
      unconfirmedTransfers,
      unverifiedCash,
      totalCollected,
      collectionEfficiency,
      airlinePayables
    };
  }, [periodFilteredTxs, airlineCommissions]);`;

content = content.replace(metricsRegex, newMetrics);

fs.writeFileSync('src/components/views/Analytics.tsx', content);
console.log('Metrics logic updated');
