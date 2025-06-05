// script.js

document.addEventListener('DOMContentLoaded', () => {
  // ======= 1) Firebase konfiguracija =======
  const firebaseConfig = {
    apiKey: "AIzaSyCIq-37qCC2YkdqTDfrB1vz9VbOtt8hvVM",
    authDomain: "modelico-kalkulator.firebaseapp.com",
    projectId: "modelico-kalkulator",
    storageBucket: "modelico-kalkulator.firebasestorage.app",
    messagingSenderId: "12370063576",
    appId: "1:12370063576:web:4b669228036e1f929567ad"
  };

  // Inicijaliziraj Firebase i Firestore
  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  // ======= 2) Selektiraj DOM elemente =======
  const form               = document.getElementById('price-form');
  const resultBox          = document.getElementById('result');
  const customerSpec       = document.getElementById('customerSpec');
  const profitChartCanvas  = document.getElementById('profitChart');

  const quantityInput         = document.getElementById('quantity');
  const weightInput           = document.getElementById('weightGrams');
  const materialInput         = document.getElementById('materialCost');
  const printTimeInput        = document.getElementById('printTime');
  const machineSelect         = document.getElementById('machineSelect');
  const machineCostInput      = document.getElementById('machineCostPerHour');
  const laborTimeInput        = document.getElementById('laborTime');
  const laborCostInput        = document.getElementById('laborCostPerHour');
  const otherCostsInput       = document.getElementById('otherCosts');
  const shippingCostInput     = document.getElementById('shippingCost');
  const actualShippingInput   = document.getElementById('actualShippingCost');
  const marginInput           = document.getElementById('marginPercent');
  const customerNameInput     = document.getElementById('customerName');
  const specialDiscountInput  = document.getElementById('specialDiscount');

  const unitCostBeforeMargin  = document.getElementById('unitCostBeforeMargin');
  const totalBeforeDiscount   = document.getElementById('totalBeforeDiscount');
  const discountInfo          = document.getElementById('discountInfo');
  const totalAfterDiscount    = document.getElementById('totalAfterDiscount');
  const shippingCostResult    = document.getElementById('shippingCostResult');
  const finalTotalPrice       = document.getElementById('finalTotalPrice');

  const addTierBtn    = document.getElementById('addTierBtn');
  const discountTable = document.getElementById('discountTable').getElementsByTagName('tbody')[0];

  let profitChart = null;

  // ======= 3) Funkcija za učitavanje aparata i popunjavanje <select> =======
  async function loadMachinesIntoSelect() {
    try {
      const snapshot = await db.collection('machines').orderBy('name').get();
      if (snapshot.empty) {
        console.warn('U Firestoreu nema nijednog dokumenta u kolekciji "machines".');
      }
      snapshot.forEach(doc => {
        const m = doc.data();
        const option = document.createElement('option');
        // value = cijenaRada; tekst = ime aparata i cijena rada
        option.value = m.cijenaRada.toFixed(2);
        option.textContent = `${m.name} (€/sat: ${m.cijenaRada.toFixed(2)})`;
        machineSelect.appendChild(option);
      });
      console.log('Opcije su napunjene u <select>:', machineSelect.options.length);
    } catch (err) {
      console.error('Greška pri dohvaćanju aparata iz Firestorea:', err);
    }
  }

  // Kad se promijeni izbor aparata, sumiraj cijenu rada
  machineSelect.addEventListener('change', () => {
    let totalMachineCost = 0;
    Array.from(machineSelect.selectedOptions).forEach(opt => {
      totalMachineCost += parseFloat(opt.value) || 0;
    });
    machineCostInput.value = totalMachineCost.toFixed(2);
  });

  // ======= 4) Dodavanje i uklanjanje redova “razreda popusta” =======
  addTierBtn.addEventListener('click', () => {
    const newRow = discountTable.insertRow();
    newRow.innerHTML = `
      <td><input type="number" class="tier-min" value="1" min="1" /></td>
      <td><input type="number" class="tier-max" value="1" min="1" /></td>
      <td><input type="number" class="tier-percent" value="0" min="0" step="0.1" /></td>
      <td><button type="button" class="remove-tier">Ukloni</button></td>
    `;
    newRow.querySelector('.remove-tier').addEventListener('click', () => {
      discountTable.removeChild(newRow);
    });
  });

  document.querySelectorAll('.remove-tier').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      discountTable.removeChild(row);
    });
  });

  // ======= 5) Funkcije za popis razreda popusta =======
  function getDiscountTiers() {
    const tiers = [];
    const rows = discountTable.querySelectorAll('tr');
    rows.forEach(row => {
      const minVal = parseInt(row.querySelector('.tier-min').value) || 0;
      const maxVal = parseInt(row.querySelector('.tier-max').value) || 0;
      const pctVal = parseFloat(row.querySelector('.tier-percent').value) || 0;
      if (minVal > 0 && maxVal >= minVal) {
        tiers.push({ min: minVal, max: maxVal, pct: pctVal });
      }
    });
    tiers.sort((a, b) => a.min - b.min);
    return tiers;
  }

  function computeQuantityDiscount(quantity, tiers) {
    for (let tier of tiers) {
      if (quantity >= tier.min && quantity <= tier.max) {
        return tier.pct;
      }
    }
    return 0;
  }

  // ======= 6) “Submit” forma – glavni izračun =======
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // 1) Pokupi unesene vrijednosti
    const quantity             = parseInt(quantityInput.value) || 1;
    const weightGrams          = parseFloat(weightInput.value) || 0;
    const materialCostPerKg    = parseFloat(materialInput.value) || 0;
    const printTimeMin         = parseFloat(printTimeInput.value) || 0;
    const machineCostPerHour   = parseFloat(machineCostInput.value) || 0;
    const laborTimeMin         = parseFloat(laborTimeInput.value) || 0;
    const laborCostPerHour     = parseFloat(laborCostInput.value) || 0;
    const otherCostsPerUnit    = parseFloat(otherCostsInput.value) || 0;
    const shippingCostForBuyer = parseFloat(shippingCostInput.value) || 0;
    const actualShippingCost   = parseFloat(actualShippingInput.value) || 0;
    const marginPercent        = parseFloat(marginInput.value) || 0;
    const customerName         = customerNameInput.value.trim();
    const specialDiscount      = parseFloat(specialDiscountInput.value) || 0;

    // 2) Izračun troška po komadu (bez marže)
    const materialCostPerUnit = (weightGrams / 1000) * materialCostPerKg;
    const printCostPerUnit    = (printTimeMin / 60) * machineCostPerHour;
    const laborCostPerUnit    = (laborTimeMin / 60) * laborCostPerHour;
    const costPerUnitBeforeMargin =
      materialCostPerUnit + printCostPerUnit + laborCostPerUnit + otherCostsPerUnit;

    // Cijena po komadu s maržom (za prihod, ne za trošak)
    const costPerUnitWithMargin =
      costPerUnitBeforeMargin * (1 + marginPercent / 100);

    // 3) Ukupna cijena prije popusta (za kupca, decimalna)
    const totalPriceBeforeDiscountDecimal = costPerUnitWithMargin * quantity;

    // 4) Popust na količinu prema razredima
    const tiers                  = getDiscountTiers();
    const discountPctByQty       = computeQuantityDiscount(quantity, tiers);
    const discountAmountDecimal  = (totalPriceBeforeDiscountDecimal * discountPctByQty) / 100;
    const totalAfterDiscountValueDecimal =
      totalPriceBeforeDiscountDecimal - discountAmountDecimal;

    // 5) Ukupni trošak (bez slanja) i konačna cijena za kupca
    const totalCostWithoutShipping   = costPerUnitBeforeMargin * quantity;
    const finalPriceDecimal          = totalAfterDiscountValueDecimal + shippingCostForBuyer;
    const totalCostWithShipping      = totalCostWithoutShipping + actualShippingCost;

    // 6) Prikaz rezultata (decimalno)
    const materialCostPerUnitDisplay      = materialCostPerUnit.toFixed(2);
    const printCostPerUnitDisplay         = printCostPerUnit.toFixed(2);
    const laborCostPerUnitDisplay         = laborCostPerUnit.toFixed(2);
    const otherCostsPerUnitDisplay        = otherCostsPerUnit.toFixed(2);
    const costPerUnitBeforeMarginDisplay  = costPerUnitBeforeMargin.toFixed(2);

    const totalCostWithoutShippingDisplay = totalCostWithoutShipping.toFixed(2);
    const discountAmountDisplay           = discountAmountDecimal.toFixed(2);
    const totalAfterDiscountDisplay       = totalAfterDiscountValueDecimal.toFixed(2);
    const actualShippingCostDisplay       = actualShippingCost.toFixed(2);

    const shippingCostForBuyerDisplay     = shippingCostForBuyer.toFixed(2);
    const finalPriceDisplay               = finalPriceDecimal.toFixed(2);

    unitCostBeforeMargin.innerHTML = `
      <strong>Trošak po komadu:</strong> ${costPerUnitBeforeMarginDisplay} €<br/>
      <em>Razrada troška:</em><br/>
      &nbsp;&nbsp;- Materijal: ${materialCostPerUnitDisplay} €<br/>
      &nbsp;&nbsp;- Printanje: ${printCostPerUnitDisplay} €<br/>
      &nbsp;&nbsp;- Ručni rad: ${laborCostPerUnitDisplay} €<br/>
      &nbsp;&nbsp;- Ostali troškovi: ${otherCostsPerUnitDisplay} €
    `;

    totalBeforeDiscount.textContent = `Ukupni trošak za narudžbu (bez slanja): ${totalCostWithoutShippingDisplay} €`;
    discountInfo.textContent        = `Popust (${discountPctByQty}%): -${discountAmountDisplay} €`;
    totalAfterDiscount.textContent  = `Ukupno nakon popusta: ${totalCostWithoutShippingDisplay} €`;
    shippingCostResult.textContent  = `Stvarni trošak slanja: ${actualShippingCostDisplay} €`;
    finalTotalPrice.textContent     = `Ukupni trošak s poštarinom: ${totalCostWithShipping.toFixed(2)} €`;

    resultBox.hidden = false;

    // 7) Specifikacija narudžbe za kupca
    const costPerUnitRounded           = Math.ceil(costPerUnitWithMargin);
    const totalBeforeDiscountRounded   = costPerUnitRounded * quantity;
    const discountAmountRounded        = Math.ceil((totalBeforeDiscountRounded * discountPctByQty) / 100);
    const totalAfterDiscountRounded    = totalBeforeDiscountRounded - discountAmountRounded;
    const shippingCostRoundedForBuyer  = Math.ceil(shippingCostForBuyer);
    const finalPriceRounded            = totalAfterDiscountRounded + shippingCostRoundedForBuyer;

    let finalPriceWithSpecialDiscount = finalPriceRounded - specialDiscount;
    if (finalPriceWithSpecialDiscount < 0) finalPriceWithSpecialDiscount = 0;

    const today = new Date();
    const day   = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year  = today.getFullYear();
    const formattedDate = `${day}.${month}.${year}`;

    const headerForCustomer = customerName
      ? `
        <img src="logo.png" alt="logo" class="spec-logo"/>
        <p class="header-text">Informativna cijena za: ${customerName}</p>
      `
      : `<img src="logo.png" alt="logo" class="spec-logo"/>`;

    customerSpec.innerHTML = `
      <div id="specContent">
        ${headerForCustomer}
        <h3>Specifikacija narudžbe</h3>
        <p><strong>Količina:</strong> ${quantity} komada</p>
        <p><strong>Težina po komadu:</strong> ${weightGrams} g</p>
        <p><strong>Ukupna težina:</strong> ${weightGrams * quantity} g</p>
        <p><strong>Cijena po komadu:</strong> ${costPerUnitRounded} €</p>
        <hr/>
        <p><strong>Ukupno prije popusta:</strong> ${totalBeforeDiscountRounded} €</p>
        <p><strong>Popust (${discountPctByQty}%):</strong> -${discountAmountRounded} €</p>
        <p><strong>Ukupno nakon popusta:</strong> ${totalAfterDiscountRounded} €</p>
        <p><strong>Trošak slanja za kupca:</strong> ${shippingCostRoundedForBuyer} €</p>
        <hr/>
        <p style="font-size:1.1rem;"><strong>Konačna ukupna cijena za kupca:</strong> ${finalPriceRounded} €</p>
        ${
          specialDiscount > 0
          ? `<p><strong>Izvanredni popust:</strong> -${specialDiscount.toFixed(2)} €</p>
             <p style="font-size:1.1rem;"><strong>Nova konačna cijena za kupca:</strong> ${finalPriceWithSpecialDiscount.toFixed(2)} €</p>`
          : ``
        }
        <p style="margin-top:2cm; text-align:right; font-size:0.425rem; color:#555;">
          Datum izračuna: ${formattedDate}
        </p>
      </div>
      <div class="button-group">
        <button id="copyBtnInline" type="button">Kopiraj kao sliku</button>
        <button id="savePdfBtn"   type="button">Spremi kao PDF</button>
      </div>
    `;
    customerSpec.hidden = false;

    // 8) Pie chart: stvarni trošak vs zarada
    const revenueRounded      = finalPriceWithSpecialDiscount;
    const costForChart        = totalCostWithoutShipping + actualShippingCost;
    const profitForChartValue = revenueRounded - costForChart;
    const profitValueForChart = profitForChartValue < 0 ? 0 : profitForChartValue;

    if (profitChart) {
      profitChart.destroy();
    }

    profitChart = new Chart(profitChartCanvas.getContext('2d'), {
      plugins: [ChartDataLabels],
      type: 'pie',
      data: {
        labels: ['Stvarni trošak', 'Zarada'],
        datasets: [{
          data: [costForChart.toFixed(2), profitValueForChart.toFixed(2)],
          backgroundColor: ['#FF6384', '#36A2EB']
        }]
      },
      options: {
        responsive: false,
        plugins: {
          legend: {
            position: 'bottom'
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.formattedValue || '';
                return `${label}: ${value} €`;
              }
            }
          },
          datalabels: {
            color: '#ffffff',
            formatter: function(value) {
              return value + ' €';
            },
            font: {
              weight: 'bold',
              size: 12
            }
          }
        }
      }
    });

    // 9) Kopiraj kao sliku
    const copyBtnInline = document.getElementById('copyBtnInline');
    const specContent    = document.getElementById('specContent');

    copyBtnInline.addEventListener('click', () => {
      if (typeof html2canvas !== 'function') {
        alert('Greška: html2canvas nije učitan.');
        return;
      }
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        alert('Clipboard API nije podržan. Otvorite stranicu preko HTTPS ili localhost.');
        return;
      }

      html2canvas(specContent, { backgroundColor: '#ffffff', scale: 2 })
        .then((canvas) => new Promise((resolve) => canvas.toBlob(resolve)))
        .then((blob) => {
          if (!blob) {
            alert('Greška: nije moguće generirati sliku.');
            return;
          }
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            .then(() => {
              alert('Specifikacija je kopirana u međuspremnik kao slika!');
            })
            .catch((err) => {
              console.error('Greška kod kopiranja u međuspremnik:', err);
              alert('Ne mogu kopirati. Provjeri HTTPS ili localhost.');
            });
        })
        .catch((err) => {
          console.error('html2canvas greška:', err);
          alert('Greška u izradi slike. Provjeri konzolu.');
        });
    });

    // 10) Spremi kao PDF
    const savePdfBtn = document.getElementById('savePdfBtn');
    savePdfBtn.addEventListener('click', () => {
      if (typeof html2canvas !== 'function') {
        alert('Greška: html2canvas nije učitan.');
        return;
      }
      if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function') {
        alert('Greška: jsPDF nije učitan.');
        return;
      }

      html2canvas(specContent, { backgroundColor: '#ffffff', scale: 2 })
        .then((canvas) => {
          try {
            const imgData = canvas.toDataURL('image/png');
            const pdf     = new window.jspdf.jsPDF({
              unit: 'pt',
              format: 'a4',
              orientation: 'portrait'
            });
            const pdfWidth  = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save('ponuda.pdf');
          } catch (pdfErr) {
            console.error('jsPDF greška pri spremanju:', pdfErr);
            alert('Greška pri izradi PDF-a. Provjeri konzolu.');
          }
        })
        .catch((err) => {
          console.error('html2canvas greška:', err);
          alert('Greška pri izradi slike za PDF. Provjeri konzolu.');
        });
    });
  }); // === Kraj DOMContentLoaded callback ===

  // ======= 3) POZIV IZVAN CALLBACKA VIŠE NIJE POTREBAN =======
  // loadMachinesIntoSelect();  ←  Ovo više ne treba (i ne smije biti ovdje)
});
