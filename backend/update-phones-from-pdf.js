// update-phones-from-pdf.js
//
// Purpose: Update phone numbers for EXISTING website customers only, using
// the numbers found in the "One Click, Endless Possibilities" PDF export.
//
// Rules followed (as requested):
//   1. Never creates a new customer - only updates customers that already
//      exist in the website database (matched by customerId, which is the
//      same as the "Username" column in the PDF, e.g. "M2Mirza").
//   2. Only touches the phone field - nothing else on the customer record
//      is changed.
//   3. Every customer already on file is "rechecked": if the phone already
//      stored matches the PDF, it is left alone and reported as OK. If it
//      is different (or empty), it is updated and reported as CHANGED so
//      you can see exactly what was corrected.
//   4. Any username from the PDF that has no matching customer on the
//      website is skipped and listed at the end - nothing is created for it.
//
// How to run:
//   cd backend
//   node update-phones-from-pdf.js
//
// It uses the same MONGODB_URI you already have in backend/.env - no
// credentials need to be pasted in here.

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Customer = require('./models/Customer');

// Data extracted from the PDF (Username -> Phone). Phone numbers are
// normalized to the local 03XXXXXXXXX format.
const pdfPhoneData = [
  { customerId: "M2Mirza", phone: "03014108853" },
  { customerId: "M4Bilal", phone: "03056244229" },
  { customerId: "M5Alhaseeb", phone: "03088744455" },
  { customerId: "M8Zeepheadoffice", phone: "03018850784" },
  { customerId: "M9Kashitalor", phone: "03007720025" },
  { customerId: "M11shoesclub", phone: "03246269293" },
  { customerId: "M12Linkstrader", phone: "03454065619" },
  { customerId: "M16Blueshoppingmall", phone: "03137740219" },
  { customerId: "M17Alfalahmobile", phone: "03000078759" },
  { customerId: "M18Jalalstore", phone: "03134891918" },
  { customerId: "M22Ranahassan", phone: "03041511223" },
  { customerId: "M23wajadtrader", phone: "03455431658" },
  { customerId: "M24R.P.O.office", phone: "03137722738" },
  { customerId: "M22Hussain", phone: "03250397097" },
  { customerId: "M23Abdullah", phone: "03251919122" },
  { customerId: "M25Mubashir", phone: "03061722111" },
  { customerId: "M26Dua", phone: "03076552035" },
  { customerId: "M27Javid", phone: "03030281277" },
  { customerId: "M28Mubashar", phone: "03217723612" },
  { customerId: "M29Zaheer", phone: "03064913796" },
  { customerId: "M30Lala", phone: "03032682303" },
  { customerId: "M31Rehman", phone: "03081831496" },
  { customerId: "M32onedollar", phone: "03064587553" },
  { customerId: "M33", phone: "03237168462" },
  { customerId: "M35Nasarcosmetics", phone: "03071967551" },
  { customerId: "M36shanshopping", phone: "03014882630" },
  { customerId: "M37shabi", phone: "03052180292" },
  { customerId: "M38GanjShakar", phone: "03006734107" },
  { customerId: "M39shahid", phone: "03008998502" },
  { customerId: "M40Hamza", phone: "03066998214" },
  { customerId: "M41Abdulraffy", phone: "03007721428" },
  { customerId: "M42Talha", phone: "03114202936" },
  { customerId: "M43AzeemM.C", phone: "03044603134" },
  { customerId: "M50MohsinJ.C", phone: "03334500075" },
  { customerId: "M51Jamalcollection", phone: "03040116630" },
  { customerId: "M53AmanAslamHomeE.B", phone: "03095095281" },
  { customerId: "M55Abid.Camras", phone: "03057392991" },
  { customerId: "M56MazharE.B", phone: "03196353704" },
  { customerId: "M58welcome", phone: "03055170006" },
  { customerId: "M59TalhaS.C", phone: "03416980643" },
  { customerId: "M60RanaabbasS.C", phone: "03461226337" },
  { customerId: "M61SuperFernecture", phone: "02134567897" },
  { customerId: "M62SalmanB.Market", phone: "03035085275" },
  { customerId: "M64ShakeelTararS.C", phone: "03339749700" },
  { customerId: "M65olympia", phone: "03051500432" },
  { customerId: "M66IkramToor", phone: "03110063426" },
  { customerId: "M67MadinaTyer", phone: "03014594592" },
  { customerId: "M68Sh.Aman.Waqas", phone: "03157567610" },
  { customerId: "M69sh.Adil", phone: "03039054556" },
  { customerId: "M70AbidMughal", phone: "03008135504" },
  { customerId: "M71AbidOffice", phone: "03076349244" },
  { customerId: "M72Rao.Shafi.K.M", phone: "03007722412" },
  { customerId: "M73IkramK.M", phone: "03016254224" },
  { customerId: "M76SaimaAishG.B", phone: "03027737097" },
  { customerId: "M77M.TariqE.B", phone: "03197723235" },
  { customerId: "M78Dr.AliS.C", phone: "03007874608" },
  { customerId: "M81Sindhu", phone: "03350782705" },
  { customerId: "M82SaqibT.C", phone: "03082373578" },
  { customerId: "M84NoorC.B", phone: "03011088803" },
  { customerId: "M86HairStore", phone: "03037884161" },
  { customerId: "M87M.RasheedC.B", phone: "03045321068" },
  { customerId: "M89sanaullah", phone: "03007732593" },
  { customerId: "M90Alimovies", phone: "03700773477" },
  { customerId: "M91Ahmad.Bed.Sheet", phone: "03191041422" },
  { customerId: "M91GhulamS.C", phone: "03016570098" },
  { customerId: "M93Al-Makkah", phone: "03026381407" },
  { customerId: "M95MasoodCentery", phone: "03090429059" },
  { customerId: "M96UmarFarooqR.C", phone: "03075459450" },
  { customerId: "M97Rizwan1", phone: "03007739078" },
  { customerId: "M98Rizwan2", phone: "03066978684" },
  { customerId: "M99KhursheedC.B", phone: "03044768606" },
  { customerId: "M100M.NadeenM.C", phone: "03157256188" },
  { customerId: "M101Sh.IjazM.C", phone: "03232232430" },
  { customerId: "M102KashiOrignal", phone: "03270593911" },
  { customerId: "M104UnionMobile", phone: "03017684786" },
  { customerId: "M105MariaBiBi", phone: "03076842494" },
  { customerId: "M105M.SaifU.B", phone: "03090531757" },
  { customerId: "M107RanaNakashC.R", phone: "03017684455" },
  { customerId: "M108M.Javid.F", phone: "03054841439" },
  { customerId: "M109AbidAliD.B", phone: "03217728360" },
  { customerId: "M10AleeshaU.Bad", phone: "03284718826" },
  { customerId: "M112SafiBedSheet", phone: "03156818419" },
  { customerId: "M113HussnainM.C", phone: "03037135795" },
  { customerId: "M114RafiqM.C", phone: "03082092800" },
  { customerId: "M116GhulamG.B", phone: "03007374947" },
  { customerId: "M118Ahmadkashitalor", phone: "03233833744" },
  { customerId: "M121MirzaMobile", phone: "03006946568" },
  { customerId: "M122AhmadHome", phone: "03191041422" },
  { customerId: "M123M.AbbasC.M", phone: "03024706454" },
  { customerId: "M124IrfanD.B", phone: "03038277121" },
  { customerId: "M125AwaisInterprices", phone: "03025537003" },
  { customerId: "M126AhmadAliCorpraction", phone: "03002218168" },
  { customerId: "M127AliChC.B", phone: "03012782379" },
  { customerId: "M128UK.Moters", phone: "03002247601" },
  { customerId: "M131Baba.Freed.Jewlars", phone: "03077153668" },
  { customerId: "M132IsrarShah", phone: "03007721428" },
  { customerId: "M134Sh.UmarC.B", phone: "03007734839" },
  { customerId: "M135Rana.Hanif", phone: "03007852678" },
  { customerId: "M136AhmadSheikhR.C", phone: "03012658193" },
  { customerId: "M138Shabir.Tiles.Display", phone: "03066433769" },
  { customerId: "M139RafiqAhmadShopC.B", phone: "03082092800" },
  { customerId: "M140QasimAli", phone: "03222526200" },
  { customerId: "M42KhaldaG.B", phone: "03037830952" },
  { customerId: "M143ShahidG.C", phone: "03336278140" },
  { customerId: "M145Jamilc.b", phone: "03085960611" },
  { customerId: "M147IqbalT.v", phone: "03016937231" },
  { customerId: "M148RiasatAli", phone: "03017720847" },
  { customerId: "M149TahirTraders", phone: "03007735507" },
  { customerId: "M150FakharE.B", phone: "03016533442" },
  { customerId: "M151RifatR.C", phone: "03001721719" },
  { customerId: "Model1", phone: "03043517071" },
  { customerId: "Model3", phone: "03043517071" },
  { customerId: "Model6", phone: "03043517071" },
  { customerId: "M159AkbarCrocary", phone: "03037135795" },
  { customerId: "M61UmairS.C", phone: "03027740371" },
  { customerId: "M162TajmalA.B", phone: "03337948987" },
  { customerId: "M163Sh.Umar.A.B", phone: "03070563027" },
  { customerId: "AshfaqM.M", phone: "03081213366" },
  { customerId: "M165NadeemS.C", phone: "03017412935" },
  { customerId: "M165M.AfzalC.V", phone: "03007720547" },
  { customerId: "M166Hadi.Mobile", phone: "03156645186" },
  { customerId: "M167Ali.Electronics", phone: "03037894046" },
  { customerId: "M165AzharAli", phone: "03073217096" },
  { customerId: "M166Uni.Optical", phone: "03278088130" },
  { customerId: "M167Nakash.Home", phone: "03017684455" },
  { customerId: "M167Sohail", phone: "03146468667" },
  { customerId: "M140Nelam.Center", phone: "03029029518" },
  { customerId: "M140Ch.Waqar", phone: "03012782379" },
  { customerId: "M141Abdul.Latif.S.C", phone: "03027722794" },
  { customerId: "M143Adeel.C.C", phone: "03078630204" },
  { customerId: "M144Umer.Khatab", phone: "03067398356" },
  { customerId: "M146Sajid.Khalid", phone: "03070562798" },
  { customerId: "M147Asadullah.M.C", phone: "03104477611" },
  { customerId: "M170Noman.Jutt", phone: "03106812302" },
  { customerId: "M171Abid.Jewlar.C.B", phone: "03336001600" },
  { customerId: "M172Abdullah.Gull.M.C", phone: "03190493271" },
  { customerId: "M173M.Qaisar", phone: "03007727364" },
  { customerId: "M174M.Ramzan.C.B", phone: "03087733442" },
  { customerId: "M175Shazad.J", phone: "03008936834" },
  { customerId: "M176ShakeelG.B", phone: "03014019344" },
  { customerId: "M175Kabir", phone: "03123310441" },
  { customerId: "M175Khalid.Shoes", phone: "03077851949" },
  { customerId: "M177Nazam", phone: "03012331517" },
  { customerId: "M174KashaC.B", phone: "03007334902" },
  { customerId: "M175Aman.Aslam.Godam.F.B", phone: "03064587553" },
  { customerId: "M175RayazR.C", phone: "03217720328" },
  { customerId: "M176Hafiz.Dua.Trader", phone: "03076552035" },
  { customerId: "M177Samina.M.C", phone: "03026464336" },
  { customerId: "M180AzeemC.B", phone: "03063695006" },
  { customerId: "M179KhaldaS.C", phone: "03208717514" },
  { customerId: "M68.Krachi.Sale.Mala", phone: "03040456911" },
  { customerId: "M169M.Azan.C.B", phone: "03065155192" },
  { customerId: "M170M.AbbasC.B", phone: "03016572611" },
  { customerId: "M171Mussa", phone: "03166809966" },
  { customerId: "M167UmerBhattiA.B", phone: "03067513317" },
  { customerId: "M170M.Javed.M.C", phone: "03327037895" },
  { customerId: "M170Al.Rahim.Centry", phone: "03007721771" },
  { customerId: "M171HitShoes", phone: "03071006659" },
  { customerId: "M170Rasmo.O.Rewaj", phone: "03211138062" },
  { customerId: "M71Parl.Shoes", phone: "03006338340" },
  { customerId: "M72FaisalS.C", phone: "03055257060" },
  { customerId: "M173Ali.Popular.C.B", phone: "03256895309" },
  { customerId: "M161ShameerG.B", phone: "03007800337" },
  { customerId: "M173Afzal.Mobile", phone: "03027942651" },
  { customerId: "M163MianSaqib", phone: "03336711213" },
  { customerId: "M164SulamanCloth", phone: "03014892925" },
  { customerId: "M161Dimond.Bedsheet", phone: "03061815635" },
  { customerId: "M163Amar.Optical", phone: "03037982609" },
  { customerId: "M164Bhazad.Mobile", phone: "03197295143" },
  { customerId: "M163AlharamTravel", phone: "03006523688" },
  { customerId: "M164HajiSaidM.Jewlar", phone: "03070562790" },
  { customerId: "M163Shaheen.Corpraction", phone: "03356810041" },
  { customerId: "M164Mujahid.Crocry", phone: "03228974878" },
  { customerId: "M167Essa.Mobile", phone: "03061419656" },
  { customerId: "M182Darakshanda", phone: "03327175385" },
  { customerId: "M185Vehari.aviation", phone: "03344736931" },
  { customerId: "M186Super.Furniture.Shop", phone: "03064962797" },
  { customerId: "School01", phone: "03046952692" },
  { customerId: "School02", phone: "03046952692" },
  { customerId: "School03", phone: "03046952692" },
  { customerId: "M251Shabbir&sons", phone: "03061484806" },
  { customerId: "M252QasimA.B", phone: "03037844135" },
  { customerId: "M253KarimS.C", phone: "03004046576" },
  { customerId: "M192ShairAliKhan", phone: "03015409016" },
  { customerId: "M254AhmadU.B", phone: "03012658193" },
  { customerId: "M255Akram.A.B", phone: "03027724059" },
  { customerId: "M255.Mubashar.Shop", phone: "03129022111" },
  { customerId: "M256AbubakarU.B", phone: "03056655466" },
  { customerId: "M257SubhanAllahV.B", phone: "03015224910" },
  { customerId: "M257IrfanR.C", phone: "03408683170" },
  { customerId: "M257Ashraf.Cloth", phone: "03048263363" },
  { customerId: "M258Suhnari.Cotton", phone: "03216836746" },
  { customerId: "M258Iqbalt.v.Home", phone: "03016937231" },
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  let updated = 0;
  let alreadyCorrect = 0;
  let notFound = [];

  for (const entry of pdfPhoneData) {
    const customer = await Customer.findOne({ customerId: entry.customerId });

    if (!customer) {
      notFound.push(entry.customerId);
      continue;
    }

    if (customer.phone === entry.phone) {
      alreadyCorrect++;
      continue;
    }

    const oldPhone = customer.phone || '(empty)';
    customer.phone = entry.phone;
    await customer.save();
    updated++;
    console.log(`Updated ${entry.customerId}: ${oldPhone} -> ${entry.phone}`);
  }

  console.log('\n===== SUMMARY =====');
  console.log(`Total entries in PDF: ${pdfPhoneData.length}`);
  console.log(`Updated (phone was missing/different): ${updated}`);
  console.log(`Already correct (no change needed): ${alreadyCorrect}`);
  console.log(`Not found on website (skipped, nothing created): ${notFound.length}`);
  if (notFound.length > 0) {
    console.log('Usernames from PDF not found on website:');
    console.log(notFound.join(', '));
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
