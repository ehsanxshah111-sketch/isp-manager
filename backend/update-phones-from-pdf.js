// update-phones-from-pdf.js
//
// Purpose: For every customer that ALREADY exists on your website, find the
// matching person in the "One Click, Endless Possibilities" PDF and copy
// their phone number in. Nothing else is changed, and nobody new is created.
//
// How the matching works:
//   - The PDF's "Username" column (e.g. "M2Mirza") is the exact same value
//     as this website's customerId - that's how your own import script
//     (import-data.js) originally set customerId for every customer, so it
//     is a reliable, exact key - not a guess.
//   - For every match, the console prints BOTH the website's stored name
//     and the PDF's full name side by side, so you can visually confirm
//     with your own eyes ("id AND name") that it's the right person before
//     trusting the result. If the two names don't look like the same
//     person at all, that line is flagged with a WARNING instead of being
//     silently updated - review those manually.
//
// Rules:
//   1. Only customers already on your website are touched - matched by
//      customerId. No new customer is ever created.
//   2. Only the phone field is changed.
//   3. If the phone already on file matches the PDF, it's left alone and
//      reported as OK (this is the "recheck").
//   4. Any PDF username with no matching website customer is skipped and
//      listed at the end - nothing is created for it.
//
// I can't run this myself - this tool only has access to the files here,
// not a live connection to your website's database. Run it yourself with:
//   cd backend
//   node update-phones-from-pdf.js
// It reads MONGODB_URI from backend/.env automatically - no need to paste
// any credentials into this file.

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Customer = require('./models/Customer');

// Data extracted from the PDF: customerId (= PDF Username), the PDF's own
// internal ID and full name (for the side-by-side check below), and the
// phone number, normalized to the local 03XXXXXXXXX format.
const pdfData = [
  { customerId: "M2Mirza", pdfId: "5038", pdfName: "Arslan G block", phone: "03014108853" },
  { customerId: "M4Bilal", pdfId: "5040", pdfName: "Muhammad Bilal", phone: "03056244229" },
  { customerId: "M5Alhaseeb", pdfId: "5041", pdfName: "Shakar", phone: "03088744455" },
  { customerId: "M8Zeepheadoffice", pdfId: "5043", pdfName: "Xyz", phone: "03018850784" },
  { customerId: "M9Kashitalor", pdfId: "5044", pdfName: "Ali plaza", phone: "03007720025" },
  { customerId: "M11shoesclub", pdfId: "5045", pdfName: "Jawaid mobiles", phone: "03246269293" },
  { customerId: "M12Linkstrader", pdfId: "5046", pdfName: "Ali Humayio", phone: "03454065619" },
  { customerId: "M16Blueshoppingmall", pdfId: "5049", pdfName: "Mubashir Churi Bazar", phone: "03137740219" },
  { customerId: "M17Alfalahmobile", pdfId: "5050", pdfName: "Mohsin sister", phone: "03000078759" },
  { customerId: "M18Jalalstore", pdfId: "5051", pdfName: "Rahman centry", phone: "03134891918" },
  { customerId: "M22Ranahassan", pdfId: "5055", pdfName: "Rana Hassan", phone: "03041511223" },
  { customerId: "M23wajadtrader", pdfId: "9559", pdfName: "Rahman Centry House", phone: "03455431658" },
  { customerId: "M24R.P.O.office", pdfId: "11642", pdfName: "Sardar & Go", phone: "03137722738" },
  { customerId: "M22Hussain", pdfId: "17538", pdfName: "Ch Hussain", phone: "03250397097" },
  { customerId: "M23Abdullah", pdfId: "17561", pdfName: "Abdullah sb G.block", phone: "03251919122" },
  { customerId: "M25Mubashir", pdfId: "17839", pdfName: "Hamidia Cloth", phone: "03061722111" },
  { customerId: "M26Dua", pdfId: "17840", pdfName: "Dua traders", phone: "03076552035" },
  { customerId: "M27Javid", pdfId: "17918", pdfName: "Javid", phone: "03030281277" },
  { customerId: "M28Mubashar", pdfId: "18769", pdfName: "Mubashar A block", phone: "03217723612" },
  { customerId: "M29Zaheer", pdfId: "18783", pdfName: "Zaheer", phone: "03064913796" },
  { customerId: "M30Lala", pdfId: "18788", pdfName: "Sheikh house F.T", phone: "03032682303" },
  { customerId: "M31Rehman", pdfId: "21073", pdfName: "Nadeem jewlar", phone: "03081831496" },
  { customerId: "M32onedollar", pdfId: "22932", pdfName: "Aman aslam", phone: "03064587553" },
  { customerId: "M33", pdfId: "24950", pdfName: "Iqbal bakri", phone: "03237168462" },
  { customerId: "M35Nasarcosmetics", pdfId: "27407", pdfName: "Nasar cosmetics", phone: "03071967551" },
  { customerId: "M36shanshopping", pdfId: "27473", pdfName: "Shan Shopping C.Block", phone: "03014882630" },
  { customerId: "M37shabi", pdfId: "28434", pdfName: "Wasli mobiles", phone: "03052180292" },
  { customerId: "M38GanjShakar", pdfId: "28440", pdfName: "Ganj shakar cloths", phone: "03006734107" },
  { customerId: "M39shahid", pdfId: "28561", pdfName: "Shahid kachi mandi", phone: "03008998502" },
  { customerId: "M40Hamza", pdfId: "28652", pdfName: "Hamza Madina Cloni", phone: "03066998214" },
  { customerId: "M41Abdulraffy", pdfId: "28731", pdfName: "Xyz", phone: "03007721428" },
  { customerId: "M42Talha", pdfId: "28804", pdfName: "Talha sheikh F. T", phone: "03114202936" },
  { customerId: "M43AzeemM.C", pdfId: "29125", pdfName: "Azeem Malik", phone: "03044603134" },
  { customerId: "M50MohsinJ.C", pdfId: "31556", pdfName: "Mohsin G.B", phone: "03334500075" },
  { customerId: "M51Jamalcollection", pdfId: "32551", pdfName: "Jamal colection", phone: "03040116630" },
  { customerId: "M53AmanAslamHomeE.B", pdfId: "33858", pdfName: "Akmal", phone: "03095095281" },
  { customerId: "M55Abid.Camras", pdfId: "33935", pdfName: "Abid Nazeer Camras Quater", phone: "03057392991" },
  { customerId: "M56MazharE.B", pdfId: "33958", pdfName: "Mazhar Rao E.Block", phone: "03196353704" },
  { customerId: "M58welcome", pdfId: "34035", pdfName: "M.Naveed G.B", phone: "03055170006" },
  { customerId: "M59TalhaS.C", pdfId: "34058", pdfName: "Xyz", phone: "03416980643" },
  { customerId: "M60RanaabbasS.C", pdfId: "34133", pdfName: "Rana Abbas Sarhand Cloni", phone: "03461226337" },
  { customerId: "M61SuperFernecture", pdfId: "34317", pdfName: "Zeeshan Butt", phone: "02134567897" },
  { customerId: "M62SalmanB.Market", pdfId: "34399", pdfName: "Hussnain M.C", phone: "03035085275" },
  { customerId: "M64ShakeelTararS.C", pdfId: "34467", pdfName: "Muneeb Tarar", phone: "03339749700" },
  { customerId: "M65olympia", pdfId: "34706", pdfName: "Olympia travel", phone: "03051500432" },
  { customerId: "M66IkramToor", pdfId: "34727", pdfName: "Ikram toor", phone: "03110063426" },
  { customerId: "M67MadinaTyer", pdfId: "34908", pdfName: "Kashif", phone: "03014594592" },
  { customerId: "M68Sh.Aman.Waqas", pdfId: "34915", pdfName: "Sheikh Aman Waqas", phone: "03157567610" },
  { customerId: "M69sh.Adil", pdfId: "34984", pdfName: "Sh. Adil S.C", phone: "03039054556" },
  { customerId: "M70AbidMughal", pdfId: "35050", pdfName: "M Ishfaq Abid worker", phone: "03008135504" },
  { customerId: "M71AbidOffice", pdfId: "35171", pdfName: "Rana sb", phone: "03076349244" },
  { customerId: "M72Rao.Shafi.K.M", pdfId: "35197", pdfName: "Madina Febric", phone: "03007722412" },
  { customerId: "M73IkramK.M", pdfId: "35198", pdfName: "Ikram k.M", phone: "03016254224" },
  { customerId: "M76SaimaAishG.B", pdfId: "35255", pdfName: "Saima aish", phone: "03027737097" },
  { customerId: "M77M.TariqE.B", pdfId: "35278", pdfName: "M Tariq", phone: "03197723235" },
  { customerId: "M78Dr.AliS.C", pdfId: "35305", pdfName: "Ali Awan", phone: "03007874608" },
  { customerId: "M81Sindhu", pdfId: "35606", pdfName: "Xyz", phone: "03350782705" },
  { customerId: "M82SaqibT.C", pdfId: "36200", pdfName: "Xyz", phone: "03082373578" },
  { customerId: "M84NoorC.B", pdfId: "37168", pdfName: "Noor C.Block", phone: "03011088803" },
  { customerId: "M86HairStore", pdfId: "37821", pdfName: "Hair Store", phone: "03037884161" },
  { customerId: "M87M.RasheedC.B", pdfId: "37852", pdfName: "M Rasheed Jutt C.Block", phone: "03045321068" },
  { customerId: "M89sanaullah", pdfId: "40062", pdfName: "Sana Ullah", phone: "03007732593" },
  { customerId: "M90Alimovies", pdfId: "40617", pdfName: "Xyz", phone: "03700773477" },
  { customerId: "M91Ahmad.Bed.Sheet", pdfId: "41553", pdfName: "Ahmad bed sheet", phone: "03191041422" },
  { customerId: "M91GhulamS.C", pdfId: "41969", pdfName: "A.R.M Farma. Farhan G.B", phone: "03016570098" },
  { customerId: "M93Al-Makkah", pdfId: "42043", pdfName: "Shokat Ali sb", phone: "03026381407" },
  { customerId: "M95MasoodCentery", pdfId: "42280", pdfName: "Abdulrahman", phone: "03090429059" },
  { customerId: "M96UmarFarooqR.C", pdfId: "42801", pdfName: "Umar Farooq Rahmania cloni", phone: "03075459450" },
  { customerId: "M97Rizwan1", pdfId: "43115", pdfName: "Imran pemper house", phone: "03007739078" },
  { customerId: "M98Rizwan2", pdfId: "43116", pdfName: "M Saim", phone: "03066978684" },
  { customerId: "M99KhursheedC.B", pdfId: "44094", pdfName: "Khuraheed Alam", phone: "03044768606" },
  { customerId: "M100M.NadeenM.C", pdfId: "44165", pdfName: "M Nadeem", phone: "03157256188" },
  { customerId: "M101Sh.IjazM.C", pdfId: "44177", pdfName: "Sh Ijaz", phone: "03232232430" },
  { customerId: "M102KashiOrignal", pdfId: "44340", pdfName: "Xyz", phone: "03270593911" },
  { customerId: "M104UnionMobile", pdfId: "44596", pdfName: "Union Mobile", phone: "03017684786" },
  { customerId: "M105MariaBiBi", pdfId: "44616", pdfName: "J. K. M", phone: "03076842494" },
  { customerId: "M105M.SaifU.B", pdfId: "44669", pdfName: "Sauc u.b", phone: "03090531757" },
  { customerId: "M107RanaNakashC.R", pdfId: "44689", pdfName: "Rana Nakash", phone: "03017684455" },
  { customerId: "M108M.Javid.F", pdfId: "45063", pdfName: "M. Javid", phone: "03054841439" },
  { customerId: "M109AbidAliD.B", pdfId: "46209", pdfName: "Abid Ali", phone: "03217728360" },
  { customerId: "M10AleeshaU.Bad", pdfId: "46257", pdfName: "Aleesha bibi", phone: "03284718826" },
  { customerId: "M112SafiBedSheet", pdfId: "46550", pdfName: "Majid Amin", phone: "03156818419" },
  { customerId: "M113HussnainM.C", pdfId: "46576", pdfName: "Salman Dultana Market", phone: "03037135795" },
  { customerId: "M114RafiqM.C", pdfId: "46882", pdfName: "Rafiq Ahmed", phone: "03082092800" },
  { customerId: "M116GhulamG.B", pdfId: "47807", pdfName: "Xyz", phone: "03007374947" },
  { customerId: "M118Ahmadkashitalor", pdfId: "48122", pdfName: "Ali Electronics", phone: "03233833744" },
  { customerId: "M121MirzaMobile", pdfId: "48814", pdfName: "Xyz", phone: "03006946568" },
  { customerId: "M122AhmadHome", pdfId: "50126", pdfName: "Ahmad Home", phone: "03191041422" },
  { customerId: "M123M.AbbasC.M", pdfId: "50319", pdfName: "M Abbas", phone: "03024706454" },
  { customerId: "M124IrfanD.B", pdfId: "51643", pdfName: "Irfan", phone: "03038277121" },
  { customerId: "M125AwaisInterprices", pdfId: "51684", pdfName: "Awais interprices", phone: "03025537003" },
  { customerId: "M126AhmadAliCorpraction", pdfId: "51723", pdfName: "Amir", phone: "03002218168" },
  { customerId: "M127AliChC.B", pdfId: "52241", pdfName: "Ali ch", phone: "03012782379" },
  { customerId: "M128UK.Moters", pdfId: "52375", pdfName: "Rao M. Tasleem", phone: "03002247601" },
  { customerId: "M131Baba.Freed.Jewlars", pdfId: "53468", pdfName: "Abid Ali", phone: "03077153668" },
  { customerId: "M132IsrarShah", pdfId: "53748", pdfName: "Israr Shah", phone: "03007721428" },
  { customerId: "M134Sh.UmarC.B", pdfId: "53973", pdfName: "Umar usman cloth house", phone: "03007734839" },
  { customerId: "M135Rana.Hanif", pdfId: "54140", pdfName: "Rana Hanif", phone: "03007852678" },
  { customerId: "M136AhmadSheikhR.C", pdfId: "54543", pdfName: "Ahmad Sheikh", phone: "03012658193" },
  { customerId: "M138Shabir.Tiles.Display", pdfId: "55366", pdfName: "Shabir Tiles Display", phone: "03066433769" },
  { customerId: "M139RafiqAhmadShopC.B", pdfId: "55369", pdfName: "Rafiq Ahmad Shop c.b", phone: "03082092800" },
  { customerId: "M140QasimAli", pdfId: "56120", pdfName: "Xyz", phone: "03222526200" },
  { customerId: "M42KhaldaG.B", pdfId: "56447", pdfName: "Khalda habib", phone: "03037830952" },
  { customerId: "M143ShahidG.C", pdfId: "56492", pdfName: "Safi and sons", phone: "03336278140" },
  { customerId: "M145Jamilc.b", pdfId: "57886", pdfName: "Xyz", phone: "03085960611" },
  { customerId: "M147IqbalT.v", pdfId: "58006", pdfName: "Xyz", phone: "03016937231" },
  { customerId: "M148RiasatAli", pdfId: "58995", pdfName: "Riasat Ali", phone: "03017720847" },
  { customerId: "M149TahirTraders", pdfId: "59003", pdfName: "Tahir Traders", phone: "03007735507" },
  { customerId: "M150FakharE.B", pdfId: "59177", pdfName: "Fakhar raza", phone: "03016533442" },
  { customerId: "M151RifatR.C", pdfId: "59279", pdfName: "Rifat", phone: "03001721719" },
  { customerId: "Model1", pdfId: "59380", pdfName: "Rahmat Jewlars", phone: "03043517071" },
  { customerId: "Model3", pdfId: "59382", pdfName: "Xyz", phone: "03043517071" },
  { customerId: "Model6", pdfId: "59385", pdfName: "Ateeq karyana", phone: "03043517071" },
  { customerId: "M159AkbarCrocary", pdfId: "59559", pdfName: "Hussain", phone: "03037135795" },
  { customerId: "M61UmairS.C", pdfId: "61601", pdfName: "Kashif trader", phone: "03027740371" },
  { customerId: "M162TajmalA.B", pdfId: "62129", pdfName: "Haji tajmal hussain", phone: "03337948987" },
  { customerId: "M163Sh.Umar.A.B", pdfId: "62250", pdfName: "Sh Umar", phone: "03070563027" },
  { customerId: "AshfaqM.M", pdfId: "65026", pdfName: "M Ashfaq", phone: "03081213366" },
  { customerId: "M165NadeemS.C", pdfId: "68099", pdfName: "Nadeem s.c", phone: "03017412935" },
  { customerId: "M165M.AfzalC.V", pdfId: "68189", pdfName: "M Afzal", phone: "03007720547" },
  { customerId: "M166Hadi.Mobile", pdfId: "68448", pdfName: "Hadi mobile", phone: "03156645186" },
  { customerId: "M167Ali.Electronics", pdfId: "68789", pdfName: "Kashi home", phone: "03037894046" },
  { customerId: "M165AzharAli", pdfId: "69525", pdfName: "Azhar Ali", phone: "03073217096" },
  { customerId: "M166Uni.Optical", pdfId: "69637", pdfName: "M Hasnain", phone: "03278088130" },
  { customerId: "M167Nakash.Home", pdfId: "69910", pdfName: "Rana Nakash Home", phone: "03017684455" },
  { customerId: "M167Sohail", pdfId: "70001", pdfName: "Sohail", phone: "03146468667" },
  { customerId: "M140Nelam.Center", pdfId: "70772", pdfName: "Zain-ul-abdin", phone: "03029029518" },
  { customerId: "M140Ch.Waqar", pdfId: "71604", pdfName: "Waqar", phone: "03012782379" },
  { customerId: "M141Abdul.Latif.S.C", pdfId: "71611", pdfName: "Abdul Latif", phone: "03027722794" },
  { customerId: "M143Adeel.C.C", pdfId: "71633", pdfName: "M Adeel Ahmad", phone: "03078630204" },
  { customerId: "M144Umer.Khatab", pdfId: "72027", pdfName: "Umer khatab", phone: "03067398356" },
  { customerId: "M146Sajid.Khalid", pdfId: "72298", pdfName: "Sajid khalid", phone: "03070562798" },
  { customerId: "M147Asadullah.M.C", pdfId: "73581", pdfName: "Asadullah khan", phone: "03104477611" },
  { customerId: "M170Noman.Jutt", pdfId: "74136", pdfName: "Noman jutt", phone: "03106812302" },
  { customerId: "M171Abid.Jewlar.C.B", pdfId: "74157", pdfName: "Ahsan Raza Abid", phone: "03336001600" },
  { customerId: "M172Abdullah.Gull.M.C", pdfId: "74268", pdfName: "Abdullah Gull", phone: "03190493271" },
  { customerId: "M173M.Qaisar", pdfId: "74343", pdfName: "M Qaisar", phone: "03007727364" },
  { customerId: "M174M.Ramzan.C.B", pdfId: "76239", pdfName: "M.Ramzan", phone: "03087733442" },
  { customerId: "M175Shazad.J", pdfId: "76326", pdfName: "M Shazad", phone: "03008936834" },
  { customerId: "M176ShakeelG.B", pdfId: "77446", pdfName: "Rana M Shakeel", phone: "03014019344" },
  { customerId: "M175Kabir", pdfId: "78103", pdfName: "Kabir", phone: "03123310441" },
  { customerId: "M175Khalid.Shoes", pdfId: "80091", pdfName: "Xyz", phone: "03077851949" },
  { customerId: "M177Nazam", pdfId: "81236", pdfName: "M.Nazam", phone: "03012331517" },
  { customerId: "M174KashaC.B", pdfId: "81398", pdfName: "Kasha", phone: "03007334902" },
  { customerId: "M175Aman.Aslam.Godam.F.B", pdfId: "81813", pdfName: "Aman Aslam", phone: "03064587553" },
  { customerId: "M175RayazR.C", pdfId: "81915", pdfName: "Rayaz Ali", phone: "03217720328" },
  { customerId: "M176Hafiz.Dua.Trader", pdfId: "81932", pdfName: "Hafiz", phone: "03076552035" },
  { customerId: "M177Samina.M.C", pdfId: "82003", pdfName: "Samina Siddique", phone: "03026464336" },
  { customerId: "M180AzeemC.B", pdfId: "84188", pdfName: "Xyz", phone: "03063695006" },
  { customerId: "M179KhaldaS.C", pdfId: "84869", pdfName: "Khalda Parveen", phone: "03208717514" },
  { customerId: "M68.Krachi.Sale.Mala", pdfId: "86590", pdfName: "M. Bilal", phone: "03040456911" },
  { customerId: "M169M.Azan.C.B", pdfId: "86714", pdfName: "M Azan", phone: "03065155192" },
  { customerId: "M170M.AbbasC.B", pdfId: "86717", pdfName: "M Abbas", phone: "03016572611" },
  { customerId: "M171Mussa", pdfId: "86725", pdfName: "Mussa", phone: "03166809966" },
  { customerId: "M167UmerBhattiA.B", pdfId: "88169", pdfName: "Umer Bhatti", phone: "03067513317" },
  { customerId: "M170M.Javed.M.C", pdfId: "88699", pdfName: "M. Javed M.C", phone: "03327037895" },
  { customerId: "M170Al.Rahim.Centry", pdfId: "89076", pdfName: "Zafar Mahmood", phone: "03007721771" },
  { customerId: "M171HitShoes", pdfId: "89085", pdfName: "M Ahtasham", phone: "03071006659" },
  { customerId: "M170Rasmo.O.Rewaj", pdfId: "96251", pdfName: "Arslan", phone: "03211138062" },
  { customerId: "M71Parl.Shoes", pdfId: "96281", pdfName: "Sh Atiq", phone: "03006338340" },
  { customerId: "M72FaisalS.C", pdfId: "97129", pdfName: "Faisal", phone: "03055257060" },
  { customerId: "M173Ali.Popular.C.B", pdfId: "97177", pdfName: "Javid C.B", phone: "03256895309" },
  { customerId: "M161ShameerG.B", pdfId: "97918", pdfName: "Xyz", phone: "03007800337" },
  { customerId: "M173Afzal.Mobile", pdfId: "98110", pdfName: "Hamayion bhatti", phone: "03027942651" },
  { customerId: "M163MianSaqib", pdfId: "98155", pdfName: "Saqib", phone: "03336711213" },
  { customerId: "M164SulamanCloth", pdfId: "98763", pdfName: "Abdul Latif", phone: "03014892925" },
  { customerId: "M161Dimond.Bedsheet", pdfId: "99444", pdfName: "Dimond Bedsheet", phone: "03061815635" },
  { customerId: "M163Amar.Optical", pdfId: "99648", pdfName: "Nasar", phone: "03037982609" },
  { customerId: "M164Bhazad.Mobile", pdfId: "100446", pdfName: "Bahzad Mobile", phone: "03197295143" },
  { customerId: "M163AlharamTravel", pdfId: "101474", pdfName: "M Irfan Shahid", phone: "03006523688" },
  { customerId: "M164HajiSaidM.Jewlar", pdfId: "101484", pdfName: "Sajid", phone: "03070562790" },
  { customerId: "M163Shaheen.Corpraction", pdfId: "102285", pdfName: "Naeem", phone: "03356810041" },
  { customerId: "M164Mujahid.Crocry", pdfId: "102430", pdfName: "M Zahid", phone: "03228974878" },
  { customerId: "M167Essa.Mobile", pdfId: "102597", pdfName: "Xyz", phone: "03061419656" },
  { customerId: "M182Darakshanda", pdfId: "103059", pdfName: "Darakshanda", phone: "03327175385" },
  { customerId: "M185Vehari.aviation", pdfId: "104399", pdfName: "Muhammad Umer", phone: "03344736931" },
  { customerId: "M186Super.Furniture.Shop", pdfId: "104403", pdfName: "Super Furnecture Shop", phone: "03064962797" },
  { customerId: "School01", pdfId: "105961", pdfName: "Jamil C.B", phone: "03046952692" },
  { customerId: "School02", pdfId: "105962", pdfName: "Xyz", phone: "03046952692" },
  { customerId: "School03", pdfId: "105963", pdfName: "Shabir and sons", phone: "03046952692" },
  { customerId: "M251Shabbir&sons", pdfId: "106235", pdfName: "Xyz", phone: "03061484806" },
  { customerId: "M252QasimA.B", pdfId: "106863", pdfName: "Qasim", phone: "03037844135" },
  { customerId: "M253KarimS.C", pdfId: "106962", pdfName: "Karim Nawaz", phone: "03004046576" },
  { customerId: "M192ShairAliKhan", pdfId: "107166", pdfName: "Shair Ali Khan", phone: "03015409016" },
  { customerId: "M254AhmadU.B", pdfId: "107297", pdfName: "Ahmad", phone: "03012658193" },
  { customerId: "M255Akram.A.B", pdfId: "107372", pdfName: "M Akram", phone: "03027724059" },
  { customerId: "M255.Mubashar.Shop", pdfId: "107692", pdfName: "Mubashar", phone: "03129022111" },
  { customerId: "M256AbubakarU.B", pdfId: "107887", pdfName: "M Abubakr Ameen", phone: "03056655466" },
  { customerId: "M257SubhanAllahV.B", pdfId: "107905", pdfName: "Naveed", phone: "03015224910" },
  { customerId: "M257IrfanR.C", pdfId: "108165", pdfName: "Irfan Ahmad", phone: "03408683170" },
  { customerId: "M257Ashraf.Cloth", pdfId: "108274", pdfName: "M Ashraf", phone: "03048263363" },
  { customerId: "M258Suhnari.Cotton", pdfId: "108430", pdfName: "Ghulam Ali", phone: "03216836746" },
  { customerId: "M258Iqbalt.v.Home", pdfId: "108442", pdfName: "Iqbal", phone: "03016937231" },
];

// Very loose "do these two names look related at all" check - just enough
// to flag obviously different people (e.g. wrong row) without rejecting
// normal formatting differences like "ARSLAN G.B" vs "Arslan G block".
function namesLookRelated(websiteName, pdfName) {
  const clean = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const a = new Set(clean(websiteName));
  const b = clean(pdfName);
  if (a.size === 0 || b.length === 0) return true; // not enough info to say either way
  return b.some((w) => a.has(w)) || [...a].some((w) => pdfName.toLowerCase().includes(w));
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  let updated = 0;
  let alreadyCorrect = 0;
  let warnings = [];
  let notFound = [];

  for (const entry of pdfData) {
    const customer = await Customer.findOne({ customerId: entry.customerId });

    if (!customer) {
      notFound.push(entry.customerId);
      continue;
    }

    const related = namesLookRelated(customer.name, entry.pdfName);
    const tag = related ? 'OK' : 'WARNING - names look different, please check';
    console.log(
      `[${entry.customerId}] website: "${customer.name}"  |  PDF(#${entry.pdfId}): "${entry.pdfName}"  -> ${tag}`
    );
    if (!related) {
      warnings.push({ customerId: entry.customerId, websiteName: customer.name, pdfName: entry.pdfName });
    }

    if (customer.phone === entry.phone) {
      alreadyCorrect++;
      continue;
    }

    const oldPhone = customer.phone || '(empty)';
    customer.phone = entry.phone;
    await customer.save();
    updated++;
    console.log(`   -> phone updated: ${oldPhone}  =>  ${entry.phone}`);
  }

  console.log('\n===== SUMMARY =====');
  console.log(`Total entries in PDF: ${pdfData.length}`);
  console.log(`Updated (phone was missing/different): ${updated}`);
  console.log(`Already correct (no change needed): ${alreadyCorrect}`);
  console.log(`Not found on website (skipped, nothing created): ${notFound.length}`);
  if (notFound.length > 0) {
    console.log('Usernames from PDF not found on website:');
    console.log(notFound.join(', '));
  }
  console.log(`Name mismatches to double check: ${warnings.length}`);
  warnings.forEach((w) => {
    console.log(`  [${w.customerId}] website: "${w.websiteName}"  vs  PDF: "${w.pdfName}"`);
  });

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
