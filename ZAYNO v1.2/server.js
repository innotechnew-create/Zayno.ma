require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "store.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

const initialProducts = [
  {id:"coque-mate-iphone", vendorId:null, status:"active", name:"Coque mate givrée pour iPhone", category:"Accessoires", price:23, oldPrice:40, stock:35, rating:4.4, sold:273, emoji:"📱", description:"Coque élégante avec protection renforcée contre les chocs. Plusieurs coloris disponibles.", colors:["Bordeaux","Noir","Rose","Bleu"], featured:true},
  {id:"ecouteurs-sans-fil", name:"Écouteurs Bluetooth sans fil", category:"Électronique", price:89, oldPrice:179, stock:28, rating:4.6, sold:1204, emoji:"🎧", description:"Écouteurs sans fil avec réduction de bruit et jusqu'à 30 heures d'autonomie.", colors:["Blanc","Noir","Rose"], featured:true},
  {id:"lampe-led-bureau", name:"Lampe de bureau LED pliable", category:"Maison", price:59, oldPrice:110, stock:42, rating:4.5, sold:588, emoji:"💡", description:"Lampe LED à trois modes d'éclairage, rechargeable par USB.", colors:["Blanc","Noir"], featured:true},
  {id:"montre-connectee", name:"Montre connectée sport", category:"Électronique", price:129, oldPrice:299, stock:19, rating:4.3, sold:412, emoji:"⌚", description:"Notifications, suivi d'activité et design moderne pour le quotidien.", colors:["Noir","Argent","Bordeaux"], featured:true},
  {id:"sac-bandouliere", name:"Sac bandoulière élégant", category:"Mode", price:75, oldPrice:150, stock:31, rating:4.5, sold:366, emoji:"👜", description:"Sac en cuir synthétique, fermeture magnétique et finition élégante.", colors:["Marron","Bordeaux","Beige"], featured:true},
  {id:"bottes-fourrees", name:"Bottes d'hiver fourrées", category:"Chaussures", price:149, oldPrice:260, stock:14, rating:4.4, sold:198, emoji:"🥾", description:"Bottes confortables avec doublure chaude et semelle antidérapante.", colors:["Bleu","Marron","Noir"], featured:true},
  {id:"ourson-peluche", name:"Ourson en peluche ultra doux", category:"Jouets", price:49, oldPrice:99, stock:50, rating:4.8, sold:902, emoji:"🧸", description:"Peluche douce de 40 cm, idéale comme cadeau.", colors:["Beige","Rose"], featured:true},
  {id:"organisateur-cuisine", name:"Panier de rangement multifonction", category:"Maison", price:35, oldPrice:70, stock:60, rating:4.2, sold:731, emoji:"🧺", description:"Panier pratique pour la cuisine, la salle de bain et la maison.", colors:["Blanc","Bordeaux","Noir"], featured:true},
  {id:"chaise-bois", name:"Chaise d'appoint style naturel", category:"Maison", price:249, oldPrice:320, stock:8, rating:4.5, sold:76, emoji:"🪑", description:"Chaise d'appoint au style épuré pour la maison.", colors:["Naturel","Noir"], featured:false},
  {id:"sac-sport", name:"Sac de sport polyvalent", category:"Sport", price:119, oldPrice:169, stock:17, rating:4.3, sold:91, emoji:"🎒", description:"Sac spacieux pour le sport et les déplacements.", colors:["Noir","Bleu"], featured:false},
  {id:"clavier", name:"Clavier compact sans fil", category:"Informatique", price:159, oldPrice:220, stock:12, rating:4.6, sold:143, emoji:"⌨️", description:"Clavier compact sans fil pour bureau et télétravail.", colors:["Noir","Blanc"], featured:false},
  {id:"gourde", name:"Gourde isotherme", category:"Sport", price:69, oldPrice:99, stock:40, rating:4.7, sold:221, emoji:"🥤", description:"Gourde réutilisable pour garder vos boissons à température.", colors:["Vert","Noir","Rose"], featured:false}
];

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = { products: initialProducts, users: [], orders: [], promotions: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { throw new Error("Le fichier data/store.json est illisible."); }
}
let db = loadDB();
if (!Array.isArray(db.products)) db.products = [];
if (!Array.isArray(db.users)) db.users = [];
if (!Array.isArray(db.orders)) db.orders = [];
if (!Array.isArray(db.promotions)) db.promotions = [];
if (!Array.isArray(db.passwordResets)) db.passwordResets = [];
if (!Array.isArray(db.categories)) {
  db.categories = [...new Set(db.products.map(p => String(p.category || '').trim()).filter(Boolean))]
    .map(name => ({id:crypto.randomUUID(),name,active:true,createdAt:new Date().toISOString()}));
}
// Migration douce des produits créés avant l'arrivée des vendeurs.
for (const product of db.products) {
  if (product.vendorId === undefined) product.vendorId = null;
  if (product.status === undefined) product.status = "active";
}
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || "dev-only-change-this-secret-before-deployment",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 250, standardHeaders: true, legacyHeaders: false }));

// Protection d'origine simple contre les requêtes cross-site. En production, HTTPS est obligatoire.
app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin && new URL(origin).host !== req.get("host")) return res.status(403).json({error:"Origine non autorisée."});
  }
  next();
});

function publicUser(user) {
  return user ? { id:user.id, name:user.name, email:user.email, role:user.role } : null;
}
function requireAuth(req,res,next) {
  if (!req.session.userId) return res.status(401).json({error:"Connectez-vous pour continuer."});
  next();
}
function requireAdmin(req,res,next) {
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user || user.role !== "admin") return res.status(403).json({error:"Accès administrateur requis."});
  next();
}
function requireSeller(req,res,next) {
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user || user.role !== "seller" || !user.sellerProfile) return res.status(403).json({error:"Accès vendeur approuvé requis."});
  next();
}
function sellerFor(userId) {
  const user = db.users.find(u => u.id === userId && u.role === "seller");
  return user?.sellerProfile || null;
}
function makeFulfillments(lines, createdAt) {
  const vendorIds = [...new Set(lines.map(line => line.vendorId || null))];
  return vendorIds.map(vendorId => ({vendorId, status:"pending", updatedAt:createdAt}));
}
function sellerLineTotal(items) {
  return items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
}

app.get("/api/health", (req,res) => res.json({status:"ok", app:"ZAYNO"}));
app.get("/api/categories", (req,res) => res.json(db.categories.filter(c=>c.active!==false).map(c=>({id:c.id,name:c.name}))));
app.get("/api/products", (req,res) => {
  const {category, q, sort} = req.query;
  let items = db.products.filter(p => p.status !== "inactive" && p.status !== "rejected");
  if (category) items = items.filter(p => p.category.toLowerCase() === String(category).toLowerCase());
  if (q) {
    const term = String(q).toLowerCase();
    items = items.filter(p => `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(term));
  }
  if (sort === "price-asc") items.sort((a,b)=>a.price-b.price);
  if (sort === "price-desc") items.sort((a,b)=>b.price-a.price);
  if (sort === "popular") items.sort((a,b)=>b.sold-a.sold);
  res.json(items);
});
app.get("/api/products/:id", (req,res) => {
  const product = db.products.find(p=>p.id===req.params.id);
  if (!product) return res.status(404).json({error:"Produit introuvable."});
  res.json(product);
});
app.post("/api/auth/register", rateLimit({windowMs:15*60*1000, limit:8}), async (req,res) => {
  const {name,email,password} = req.body || {};
  if (!name || !email || !password || password.length < 10) return res.status(400).json({error:"Nom, e-mail et mot de passe (10 caractères minimum) requis."});
  const normalized = String(email).trim().toLowerCase();
  if (db.users.some(u=>u.email===normalized)) return res.status(409).json({error:"Cette adresse e-mail est déjà utilisée."});
  const user = {id:crypto.randomUUID(), name:String(name).trim(), email:normalized, passwordHash:await bcrypt.hash(password,12), role:"customer", createdAt:new Date().toISOString()};
  db.users.push(user); saveDB(); req.session.userId=user.id;
  res.status(201).json({user:publicUser(user)});
});
function mailTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE)==="true",auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
}
async function sendAccountMail(to, subject, html) {
  const transport=mailTransport();
  if (!transport) {
    if (process.env.NODE_ENV !== "production") console.log("[ZAYNO EMAIL - DEV]", {to,subject,html});
    else throw new Error("Service e-mail non configuré.");
    return;
  }
  await transport.sendMail({from:process.env.MAIL_FROM||process.env.SMTP_USER,to,subject,html});
}

// Création d'un compte administrateur uniquement avec un code d'invitation secret défini sur Render.
app.post("/api/auth/register-admin", rateLimit({windowMs:60*60*1000,limit:5}), async (req,res) => {
  const {name,email,password,inviteCode}=req.body||{};
  const supplied=Buffer.from(String(inviteCode||""));const expected=Buffer.from(String(process.env.ADMIN_INVITE_CODE||""));
  if (!expected.length || supplied.length!==expected.length || !crypto.timingSafeEqual(supplied,expected)) return res.status(403).json({error:"Code d'invitation administrateur invalide."});
  if (!name || !email || !password || String(password).length<10) return res.status(400).json({error:"Nom, e-mail et mot de passe (10 caractères minimum) requis."});
  const normalized=String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return res.status(400).json({error:"Adresse e-mail invalide."});
  if (db.users.some(u=>u.email===normalized)) return res.status(409).json({error:"Cette adresse e-mail est déjà utilisée."});
  const user={id:crypto.randomUUID(),name:String(name).trim().slice(0,100),email:normalized,passwordHash:await bcrypt.hash(String(password),12),role:"admin",createdAt:new Date().toISOString()};
  db.users.push(user);saveDB();
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Impossible d'ouvrir la session."});req.session.userId=user.id;res.status(201).json({user:publicUser(user)});});
});

app.post("/api/auth/forgot-password", rateLimit({windowMs:15*60*1000,limit:5}), async (req,res) => {
  const email=String(req.body?.email||"").trim().toLowerCase();
  const generic={message:"Si cette adresse correspond à un compte, un lien de réinitialisation sera envoyé."};
  const user=db.users.find(u=>u.email===email);
  if (user) {
    const raw=crypto.randomBytes(32).toString("hex");
    const tokenHash=crypto.createHash("sha256").update(raw).digest("hex");
    db.passwordResets=db.passwordResets.filter(x=>x.userId!==user.id);
    db.passwordResets.push({userId:user.id,tokenHash,expiresAt:Date.now()+30*60*1000});saveDB();
    const link=`${BASE_URL}/admin.html?reset=${raw}`;
    try { await sendAccountMail(user.email,"Réinitialisation du mot de passe ZAYNO",`<div style="font-family:Arial,sans-serif"><h2>Réinitialiser votre mot de passe ZAYNO</h2><p>Ce lien est valable 30 minutes et ne peut être utilisé qu'une seule fois.</p><p><a href="${link}">Choisir un nouveau mot de passe</a></p><p>Si vous n'avez pas demandé cette modification, ignorez ce message.</p></div>`); }
    catch(e) { console.error("Échec envoi e-mail de réinitialisation:",e.message); }
  }
  res.json(generic);
});
app.post("/api/auth/reset-password", rateLimit({windowMs:15*60*1000,limit:8}), async (req,res) => {
  const token=String(req.body?.token||"");const password=String(req.body?.password||"");
  if(password.length<10)return res.status(400).json({error:"Le mot de passe doit contenir au moins 10 caractères."});
  const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
  const record=db.passwordResets.find(x=>x.tokenHash===tokenHash&&x.expiresAt>Date.now());
  if(!record)return res.status(400).json({error:"Lien invalide ou expiré. Demandez un nouveau lien."});
  const user=db.users.find(u=>u.id===record.userId);if(!user)return res.status(400).json({error:"Compte introuvable."});
  user.passwordHash=await bcrypt.hash(password,12);db.passwordResets=db.passwordResets.filter(x=>x.userId!==user.id);saveDB();
  req.session.destroy(()=>res.json({ok:true,message:"Mot de passe modifié. Vous pouvez vous connecter."}));
});

app.post("/api/auth/login", rateLimit({windowMs:15*60*1000, limit:10}), async (req,res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const user = db.users.find(u=>u.email===email);
  if (!user || !await bcrypt.compare(String(req.body?.password || ""), user.passwordHash)) return res.status(401).json({error:"E-mail ou mot de passe incorrect."});
  req.session.regenerate(err => {
    if (err) return res.status(500).json({error:"Impossible d'ouvrir la session."});
    req.session.userId=user.id;
    res.json({user:publicUser(user)});
  });
});
app.post("/api/auth/logout", (req,res) => req.session.destroy(()=>res.json({ok:true})));
app.get("/api/auth/me", (req,res) => {
  const user=db.users.find(u=>u.id===req.session.userId);
  res.json({user:publicUser(user)});
});

function validateOrder(body) {
  const {items, customer, address, city, phone, paymentMethod} = body || {};
  if (!Array.isArray(items) || !items.length || items.length > 30) return "Panier invalide.";
  if (!customer || !address || !city || !phone) return "Veuillez compléter vos coordonnées de livraison.";
  if (!/^[0-9+ ()-]{8,20}$/.test(phone)) return "Numéro de téléphone invalide.";
  if (paymentMethod !== "cod") return "Seul le paiement à la livraison est disponible pour le moment.";
  for (const item of items) {
    if (!item.id || !Number.isInteger(Number(item.quantity)) || Number(item.quantity)<1 || Number(item.quantity)>20) return "Quantité invalide.";
    const p=db.products.find(x=>x.id===item.id);
    if (!p || p.status==='inactive' || p.status==='rejected') return "Un produit de votre panier n'est plus disponible.";
    if (p.stock < Number(item.quantity)) return `Stock insuffisant pour ${p.name}.`;
  }
  return null;
}
function orderDetails(items) {
  return items.map(i => {
    const p=db.products.find(x=>x.id===i.id);
    const profile = p.vendorId ? sellerFor(p.vendorId) : null;
    return {id:p.id,name:p.name,price:p.price,quantity:Number(i.quantity),emoji:p.emoji,vendorId:p.vendorId || null,vendorName:p.vendorName || profile?.shopName || "ZAYNO"};
  });
}
app.post("/api/orders", requireAuth, async (req,res) => {
  const error=validateOrder(req.body);
  if (error) return res.status(400).json({error});
  const {items, customer, address, city, phone, paymentMethod} = req.body;
  const lines=orderDetails(items);
  const total=lines.reduce((sum,x)=>sum+x.price*x.quantity,0);
  const createdAt=new Date().toISOString();
  const order={id:"ZY-"+Date.now().toString(36).toUpperCase(),userId:req.session.userId,items:lines,total,currency:"MAD",customer,address,city,phone,paymentMethod:"cod",status:"pending",fulfillments:makeFulfillments(lines,createdAt),createdAt};
  for (const line of lines) db.products.find(p=>p.id===line.id).stock-=line.quantity;
  db.orders.push(order); saveDB();
  res.status(201).json({order:{id:order.id,total:order.total,status:order.status,paymentMethod:order.paymentMethod}});
});
app.get("/api/orders/my", requireAuth, (req,res) => res.json(db.orders.filter(o=>o.userId===req.session.userId).map(({id,total,status,createdAt,paymentMethod,items})=>({id,total,status,createdAt,paymentMethod,items}))));
app.get("/api/admin/summary", requireAuth, requireAdmin, (req,res) => res.json({
  products:db.products.length, categories:db.categories.length,
  orders:db.orders.length, customers:db.users.filter(u=>u.role==="customer").length,
  sellers:db.users.filter(u=>u.role==="seller").length,
  pendingSellers:db.users.filter(u=>u.sellerApplication?.status==="pending").length,
  revenue:db.orders.filter(o=>o.status!=="cancelled").reduce((s,o)=>s+Number(o.total||0),0),
  pendingOrders:db.orders.filter(o=>o.status==="pending").length
}));
app.get("/api/admin/products", requireAuth, requireAdmin, (req,res) => res.json(db.products));
app.put("/api/admin/products/:id", requireAuth, requireAdmin, (req,res) => {
  const p=db.products.find(x=>x.id===req.params.id); if(!p) return res.status(404).json({error:"Produit introuvable."});
  const b=req.body||{};
  if (b.category!==undefined && !db.categories.some(c=>c.active!==false && c.name.toLowerCase()===String(b.category).trim().toLowerCase())) return res.status(400).json({error:"Choisissez une catégorie active."});
  for (const k of ["name","category","description","emoji"]) if(b[k]!==undefined) p[k]=String(b[k]);
  for (const k of ["price","oldPrice","stock"]) if(b[k]!==undefined && Number.isFinite(Number(b[k])) && Number(b[k])>=0) p[k]=Number(b[k]);
  saveDB(); res.json(p);
});
app.delete("/api/admin/products/:id", requireAuth, requireAdmin, (req,res) => {
  const i=db.products.findIndex(x=>x.id===req.params.id); if(i<0) return res.status(404).json({error:"Produit introuvable."});
  db.products.splice(i,1); saveDB(); res.json({ok:true});
});
app.get("/api/admin/categories", requireAuth, requireAdmin, (req,res) => res.json(db.categories));
app.post("/api/admin/categories", requireAuth, requireAdmin, (req,res) => {
  const name=String(req.body?.name || '').trim();
  if(name.length<2 || name.length>60) return res.status(400).json({error:"Le nom de catégorie doit contenir entre 2 et 60 caractères."});
  if(db.categories.some(c=>c.name.toLowerCase()===name.toLowerCase())) return res.status(409).json({error:"Cette catégorie existe déjà."});
  const category={id:crypto.randomUUID(),name,active:true,createdAt:new Date().toISOString()};
  db.categories.push(category);saveDB();res.status(201).json(category);
});
app.put("/api/admin/categories/:id", requireAuth, requireAdmin, (req,res) => {
  const category=db.categories.find(c=>c.id===req.params.id);if(!category)return res.status(404).json({error:"Catégorie introuvable."});
  const name=String(req.body?.name || '').trim();
  if(name.length<2 || name.length>60)return res.status(400).json({error:"Le nom doit contenir entre 2 et 60 caractères."});
  if(db.categories.some(c=>c.id!==category.id && c.name.toLowerCase()===name.toLowerCase()))return res.status(409).json({error:"Cette catégorie existe déjà."});
  const oldName=category.name;category.name=name;db.products.forEach(p=>{if(p.category===oldName)p.category=name;});saveDB();res.json(category);
});
app.delete("/api/admin/categories/:id", requireAuth, requireAdmin, (req,res) => {
  const category=db.categories.find(c=>c.id===req.params.id);if(!category)return res.status(404).json({error:"Catégorie introuvable."});
  if(db.products.some(p=>p.category===category.name))return res.status(409).json({error:"Cette catégorie contient encore des produits. Déplacez-les avant de la supprimer."});
  db.categories=db.categories.filter(c=>c.id!==category.id);saveDB();res.json({ok:true});
});
app.get("/api/admin/customers", requireAuth, requireAdmin, (req,res) => res.json(db.users.filter(u=>u.role==="customer").map(({id,name,email,createdAt})=>({id,name,email,createdAt,orders:db.orders.filter(o=>o.userId===id).length}))));
app.get("/api/admin/orders", requireAuth, requireAdmin, (req,res) => res.json(db.orders));
app.patch("/api/admin/orders/:id", requireAuth, requireAdmin, (req,res) => {
  const o=db.orders.find(x=>x.id===req.params.id); if(!o) return res.status(404).json({error:"Commande introuvable."});
  const allowed=["pending","confirmed","shipped","delivered","cancelled"];
  if(!allowed.includes(req.body?.status)) return res.status(400).json({error:"Statut invalide."});
  o.status=req.body.status; saveDB(); res.json(o);
});
app.get("/api/admin/promotions", requireAuth, requireAdmin, (req,res) => res.json(db.promotions||[]));
app.post("/api/admin/promotions", requireAuth, requireAdmin, (req,res) => {
  const {code,discount}=req.body||{}; if(!code || !Number.isFinite(Number(discount)) || Number(discount)<=0 || Number(discount)>90) return res.status(400).json({error:"Code et remise entre 1 et 90 % requis."});
  db.promotions=db.promotions||[]; const item={id:crypto.randomUUID(),code:String(code).trim().toUpperCase(),discount:Number(discount),active:true,createdAt:new Date().toISOString()};
  if(db.promotions.some(x=>x.code===item.code)) return res.status(409).json({error:"Ce code existe déjà."});
  db.promotions.push(item); saveDB(); res.status(201).json(item);
});
app.delete("/api/admin/promotions/:id", requireAuth, requireAdmin, (req,res) => { db.promotions=db.promotions||[]; db.promotions=db.promotions.filter(x=>x.id!==req.params.id); saveDB(); res.json({ok:true}); });
app.post("/api/admin/products", requireAuth, requireAdmin, (req,res) => {
  const p=req.body || {};
  if (!p.name || !p.category || !Number.isFinite(Number(p.price)) || Number(p.price)<=0 || !db.categories.some(c=>c.active!==false && c.name.toLowerCase()===String(p.category).trim().toLowerCase())) return res.status(400).json({error:"Nom, prix positif et catégorie active requis."});
  const product={id:String(p.id || crypto.randomUUID()),vendorId:null,status:'active',name:String(p.name),category:String(p.category),price:Number(p.price),oldPrice:Number(p.oldPrice || p.price),stock:Math.max(0,Number(p.stock || 0)),rating:0,sold:0,emoji:p.emoji || "🛍️",description:String(p.description || ""),colors:Array.isArray(p.colors)?p.colors:[],featured:false};
  if (db.products.some(x=>x.id===product.id)) return res.status(409).json({error:"Identifiant déjà utilisé."});
  db.products.push(product); saveDB(); res.status(201).json(product);
});
// Candidatures vendeurs : seul l'administrateur peut approuver un compte vendeur.
app.get("/api/admin/sellers", requireAuth, requireAdmin, (req,res) => res.json(db.users
  .filter(u => u.sellerApplication || u.sellerProfile)
  .map(u => ({id:u.id,name:u.name,email:u.email,role:u.role,application:u.sellerApplication || u.sellerProfile,products:db.products.filter(p=>p.vendorId===u.id).length}))));
app.patch("/api/admin/sellers/:id", requireAuth, requireAdmin, (req,res) => {
  const user=db.users.find(u=>u.id===req.params.id);
  if (!user || !user.sellerApplication) return res.status(404).json({error:"Candidature vendeur introuvable."});
  const status=req.body?.status;
  if (!['approved','rejected'].includes(status)) return res.status(400).json({error:"Décision invalide."});
  user.sellerApplication.status=status;
  user.sellerApplication.reviewedAt=new Date().toISOString();
  if (status==='approved') {
    user.role='seller';
    user.sellerProfile={...user.sellerApplication,status:'approved',approvedAt:user.sellerApplication.reviewedAt};
  } else {
    user.role='customer';
    delete user.sellerProfile;
  }
  saveDB();
  res.json({ok:true,id:user.id,role:user.role,status});
});

// Espace vendeur : toutes les routes vérifient le rôle et l'identité côté serveur.
app.get("/api/seller/application", requireAuth, (req,res) => {
  const user=db.users.find(u=>u.id===req.session.userId);
  res.json({application:user?.sellerApplication || null,profile:user?.sellerProfile || null,role:user?.role || null});
});
app.post("/api/seller/apply", requireAuth, (req,res) => {
  const user=db.users.find(u=>u.id===req.session.userId);
  if (!user || user.role!=='customer') return res.status(403).json({error:"Un compte client est nécessaire pour déposer une candidature vendeur."});
  if (user.sellerApplication?.status==='pending') return res.status(409).json({error:"Votre candidature est déjà en cours d'examen."});
  const shopName=String(req.body?.shopName || '').trim();
  const phone=String(req.body?.phone || '').trim();
  const city=String(req.body?.city || '').trim();
  const businessType=String(req.body?.businessType || '').trim();
  if (shopName.length<2 || shopName.length>80 || city.length<2 || city.length>60 || !/^[0-9+ ()-]{8,20}$/.test(phone)) return res.status(400).json({error:"Nom de boutique, ville ou téléphone invalide."});
  user.sellerApplication={shopName,phone,city,businessType:businessType.slice(0,80),status:'pending',createdAt:new Date().toISOString()};
  saveDB();
  res.status(201).json({ok:true,application:user.sellerApplication});
});
app.get("/api/seller/me", requireAuth, requireSeller, (req,res) => {
  const user=db.users.find(u=>u.id===req.session.userId);
  res.json({user:publicUser(user),profile:user.sellerProfile});
});
app.get("/api/seller/summary", requireAuth, requireSeller, (req,res) => {
  const products=db.products.filter(p=>p.vendorId===req.session.userId);
  const orders=db.orders.filter(o=>o.items?.some(i=>i.vendorId===req.session.userId));
  const revenue=orders.filter(o=>o.status!=='cancelled').reduce((sum,o)=>sum+sellerLineTotal(o.items.filter(i=>i.vendorId===req.session.userId)),0);
  res.json({products:products.length,activeProducts:products.filter(p=>p.status!=='inactive').length,orders:orders.length,revenue});
});
app.get("/api/seller/categories", requireAuth, requireSeller, (req,res) => res.json(db.categories.filter(c=>c.active!==false).map(c=>c.name)));
app.get("/api/seller/products", requireAuth, requireSeller, (req,res) => res.json(db.products.filter(p=>p.vendorId===req.session.userId)));
app.post("/api/seller/products", requireAuth, requireSeller, (req,res) => {
  const b=req.body || {};
  const name=String(b.name || '').trim(), category=String(b.category || '').trim();
  const price=Number(b.price), oldPrice=b.oldPrice==='' || b.oldPrice===undefined ? price : Number(b.oldPrice), stock=Number(b.stock);
  if (name.length<2 || name.length>120 || category.length<2 || category.length>60 || !db.categories.some(c=>c.active!==false && c.name.toLowerCase()===category.toLowerCase()) || !Number.isFinite(price) || price<=0 || !Number.isFinite(oldPrice) || oldPrice<price || !Number.isInteger(stock) || stock<0 || stock>100000) return res.status(400).json({error:"Vérifiez le nom, choisissez une catégorie active et contrôlez les prix et le stock."});
  const profile=sellerFor(req.session.userId);
  const product={id:crypto.randomUUID(),vendorId:req.session.userId,vendorName:profile.shopName,status:'active',name,category,price,oldPrice,stock,rating:0,sold:0,emoji:String(b.emoji || '🛍️').slice(0,8),description:String(b.description || '').trim().slice(0,1200),colors:[],featured:false};
  db.products.push(product); saveDB(); res.status(201).json(product);
});
app.put("/api/seller/products/:id", requireAuth, requireSeller, (req,res) => {
  const p=db.products.find(x=>x.id===req.params.id && x.vendorId===req.session.userId);
  if (!p) return res.status(404).json({error:"Produit introuvable dans votre catalogue."});
  const b=req.body || {};
  const name=b.name===undefined?p.name:String(b.name).trim();
  const category=b.category===undefined?p.category:String(b.category).trim();
  const price=b.price===undefined?p.price:Number(b.price);
  const oldPrice=b.oldPrice===undefined?p.oldPrice:Number(b.oldPrice);
  const stock=b.stock===undefined?p.stock:Number(b.stock);
  if (name.length<2 || name.length>120 || category.length<2 || category.length>60 || !db.categories.some(c=>c.active!==false && c.name.toLowerCase()===category.toLowerCase()) || !Number.isFinite(price) || price<=0 || !Number.isFinite(oldPrice) || oldPrice<price || !Number.isInteger(stock) || stock<0 || stock>100000) return res.status(400).json({error:"Vérifiez le nom, choisissez une catégorie active et contrôlez les prix et le stock."});
  Object.assign(p,{name,category,price,oldPrice,stock});
  if (b.emoji!==undefined) p.emoji=String(b.emoji).slice(0,8);
  if (b.description!==undefined) p.description=String(b.description).trim().slice(0,1200);
  saveDB(); res.json(p);
});
app.delete("/api/seller/products/:id", requireAuth, requireSeller, (req,res) => {
  const p=db.products.find(x=>x.id===req.params.id && x.vendorId===req.session.userId);
  if (!p) return res.status(404).json({error:"Produit introuvable dans votre catalogue."});
  p.status='inactive'; saveDB(); res.json({ok:true,status:'inactive'});
});
app.get("/api/seller/orders", requireAuth, requireSeller, (req,res) => res.json(db.orders
  .filter(o=>o.items?.some(i=>i.vendorId===req.session.userId))
  .map(o=>({id:o.id,customer:o.customer,city:o.city,address:o.address,phone:o.phone,paymentMethod:o.paymentMethod,createdAt:o.createdAt,status:o.status,items:o.items.filter(i=>i.vendorId===req.session.userId),subtotal:sellerLineTotal(o.items.filter(i=>i.vendorId===req.session.userId)),fulfillment:o.fulfillments?.find(f=>f.vendorId===req.session.userId)?.status || 'pending'}))));
app.patch("/api/seller/orders/:id", requireAuth, requireSeller, (req,res) => {
  const order=db.orders.find(o=>o.id===req.params.id && o.items?.some(i=>i.vendorId===req.session.userId));
  if (!order) return res.status(404).json({error:"Commande introuvable pour votre boutique."});
  const fulfillment=(order.fulfillments ||= makeFulfillments(order.items,order.createdAt)).find(f=>f.vendorId===req.session.userId);
  const next=req.body?.status;
  const transitions={pending:['confirmed'],confirmed:['preparing','shipped'],preparing:['shipped'],shipped:['delivered'],delivered:[]};
  if (!fulfillment || !transitions[fulfillment.status]?.includes(next)) return res.status(400).json({error:"Transition de statut non autorisée."});
  fulfillment.status=next; fulfillment.updatedAt=new Date().toISOString(); saveDB(); res.json({ok:true,status:next});
});

// Paiement carte volontairement désactivé : aucun prestataire marocain n'est encore contractualisé ni intégré.
app.post("/api/payments/checkout", requireAuth, (req,res) => res.status(503).json({error:"Le paiement par carte n'est pas disponible. ZAYNO doit d'abord contractualiser et intégrer un prestataire adapté au Maroc."}));
app.post("/api/payments/webhook", (req,res) => res.status(503).json({error:"Aucun webhook de paiement n'est configuré dans cette version."}));

app.use(express.static(path.join(__dirname,"public")));
app.get("*", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, ()=>console.log(`ZAYNO est disponible sur ${BASE_URL}`));
