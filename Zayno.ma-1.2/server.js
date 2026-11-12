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
const Stripe = require("stripe");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "store.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

const initialProducts = [
  {id:"coque-mate-iphone", name:"Coque mate givrée pour iPhone", category:"Accessoires", price:23, oldPrice:40, stock:35, rating:4.4, sold:273, emoji:"📱", description:"Coque élégante avec protection renforcée contre les chocs. Plusieurs coloris disponibles.", colors:["Bordeaux","Noir","Rose","Bleu"], featured:true},
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
if (!Array.isArray(db.promotions)) db.promotions = [];
function saveDB() {
  // Écriture atomique : évite un store.json tronqué si le processus s’arrête pendant l’écriture.
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}

function validateEmail(email) {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validText(value, max = 180) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}
function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
}

// Cloudinary est utilisé pour que les images ne dépendent pas du disque éphémère de Render.
const cloudinaryConfigured = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (cloudinaryConfigured) cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.mimetype))
});
function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: "zayno/products", resource_type: "image" }, (error, result) => {
      if (error) reject(error); else resolve(result);
    });
    stream.end(buffer);
  });
}

if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("SESSION_SECRET doit contenir au moins 32 caractères en production.");
}
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use("/api/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || "local-development-secret-change-before-production-32",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 7, path: "/" }
}));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 250, standardHeaders: true, legacyHeaders: false }));

// Protection d'origine simple contre les requêtes cross-site. En production, HTTPS est obligatoire.
app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (parsed.host !== req.get("host") || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) return res.status(403).json({error:"Origine non autorisée."});
      } catch { return res.status(403).json({error:"Origine non autorisée."}); }
    }
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

app.get("/api/health", (req,res) => res.json({status:"ok", app:"ZAYNO"}));
app.get("/api/products", (req,res) => {
  const {category, q, sort} = req.query;
  let items = [...db.products];
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
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = req.body?.password;
  if (!validText(name, 100) || !validateEmail(email) || typeof password !== "string" || password.length < 10 || password.length > 128) {
    return res.status(400).json({error:"Nom (1 à 100 caractères), e-mail valide et mot de passe (10 à 128 caractères) requis."});
  }
  if (db.users.some(u=>String(u.email || "").trim().toLowerCase()===email)) return res.status(409).json({error:"Cette adresse e-mail est déjà utilisée."});
  const user = {id:crypto.randomUUID(), name, email, passwordHash:await bcrypt.hash(password,12), role:"customer", createdAt:new Date().toISOString()};
  db.users.push(user);
  try {
    saveDB();
    req.session.regenerate(async err => {
      if (err) return res.status(500).json({error:"Impossible de créer la session. Réessayez."});
      req.session.userId = user.id;
      try { await saveSession(req); res.status(201).json({user:publicUser(user)}); }
      catch { res.status(500).json({error:"Compte créé, mais ouverture de session impossible. Connectez-vous."}); }
    });
  } catch (err) {
    db.users = db.users.filter(u => u.id !== user.id);
    console.error("Register persistence error:", err.message);
    res.status(500).json({error:"Impossible d'enregistrer le compte."});
  }
});
app.post("/api/auth/login", rateLimit({windowMs:15*60*1000, limit:10}), async (req,res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = db.users.find(u=>String(u.email || "").trim().toLowerCase()===email);
  const hash = user?.passwordHash || user?.password_hash;
  let matches = false;
  if (user && typeof hash === "string") {
    try { matches = await bcrypt.compare(password, hash); } catch { matches = false; }
  }
  if (!matches) return res.status(401).json({error:"E-mail ou mot de passe incorrect."});
  req.session.regenerate(err => {
    if (err) return res.status(500).json({error:"Impossible d'ouvrir la session."});
    req.session.userId=user.id;
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({error:"Impossible d'enregistrer la session."});
      res.json({user:publicUser(user)});
    });
  });
});
app.post("/api/auth/logout", (req,res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({error:"Déconnexion impossible."});
    res.clearCookie("connect.sid", { httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV === "production", path:"/" });
    res.json({ok:true});
  });
});
app.get("/api/auth/me", (req,res) => {
  const user=db.users.find(u=>u.id===req.session.userId);
  if (!user && req.session.userId) return req.session.destroy(()=>res.json({user:null}));
  res.json({user:publicUser(user)});
});

function validateOrder(body) {
  const {items, customer, address, city, phone, paymentMethod} = body || {};
  if (!Array.isArray(items) || !items.length || items.length > 30) return "Panier invalide.";
  if (!validText(String(customer || ""), 120) || !validText(String(address || ""), 250) || !validText(String(city || ""), 100) || !phone) return "Veuillez compléter vos coordonnées de livraison.";
  if (!/^[0-9+ ()-]{8,20}$/.test(phone)) return "Numéro de téléphone invalide.";
  if (!["cod","stripe"].includes(paymentMethod)) return "Mode de paiement invalide.";
  if (new Set(items.map(item => item?.id)).size !== items.length) return "Un produit apparaît plusieurs fois dans le panier. Actualisez votre panier.";
  for (const item of items) {
    if (!item.id || !Number.isInteger(Number(item.quantity)) || Number(item.quantity)<1 || Number(item.quantity)>20) return "Quantité invalide.";
    const p=db.products.find(x=>x.id===item.id);
    if (!p || p.stock < Number(item.quantity)) return `Stock insuffisant pour ${p?.name || "un produit"}.`;
  }
  return null;
}
function orderDetails(items) {
  return items.map(i => {
    const p=db.products.find(x=>x.id===i.id);
    return {id:p.id,name:p.name,price:p.price,quantity:Number(i.quantity),emoji:p.emoji};
  });
}
app.post("/api/orders", requireAuth, async (req,res) => {
  const error=validateOrder(req.body);
  if (error) return res.status(400).json({error});
  const {items, customer, address, city, phone, paymentMethod} = req.body;
  if (paymentMethod === "stripe") return res.status(400).json({error:"Utilisez la route de paiement sécurisé pour la carte bancaire."});
  const lines=orderDetails(items);
  const total=lines.reduce((sum,x)=>sum+x.price*x.quantity,0);
  const order={id:"ZY-"+Date.now().toString(36).toUpperCase(),userId:req.session.userId,items:lines,total,currency:"MAD",customer,address,city,phone,paymentMethod:"cod",status:"pending",createdAt:new Date().toISOString()};
  for (const line of lines) db.products.find(p=>p.id===line.id).stock-=line.quantity;
  db.orders.push(order); saveDB();
  res.status(201).json({order:{id:order.id,total:order.total,status:order.status,paymentMethod:order.paymentMethod}});
});
app.get("/api/orders/my", requireAuth, (req,res) => res.json(db.orders.filter(o=>o.userId===req.session.userId).map(({id,total,status,createdAt,paymentMethod,items})=>({id,total,status,createdAt,paymentMethod,items}))));
app.get("/api/admin/summary", requireAuth, requireAdmin, (req,res) => res.json({
  products:db.products.length, categories:[...new Set(db.products.map(p=>p.category))].length,
  orders:db.orders.length, customers:db.users.filter(u=>u.role==="customer").length,
  revenue:db.orders.filter(o=>o.status!=="cancelled").reduce((s,o)=>s+Number(o.total||0),0),
  pendingOrders:db.orders.filter(o=>o.status==="pending").length
}));
app.get("/api/admin/products", requireAuth, requireAdmin, (req,res) => res.json(db.products));
app.put("/api/admin/products/:id", requireAuth, requireAdmin, (req,res) => {
  const p=db.products.find(x=>x.id===req.params.id); if(!p) return res.status(404).json({error:"Produit introuvable."});
  const b=req.body||{};
  if (b.imageUrl !== undefined && b.imageUrl !== "") { try { if (new URL(b.imageUrl).protocol !== "https:") throw new Error(); } catch { return res.status(400).json({error:"L’URL de l’image doit être une adresse HTTPS valide."}); } }
  for (const k of ["name","category","description","emoji","imageUrl"]) if(b[k]!==undefined) p[k]=String(b[k]);
  for (const k of ["price","oldPrice","stock"]) if(b[k]!==undefined && Number.isFinite(Number(b[k]))) p[k]=Number(b[k]);
  saveDB(); res.json(p);
});
app.delete("/api/admin/products/:id", requireAuth, requireAdmin, (req,res) => {
  const i=db.products.findIndex(x=>x.id===req.params.id); if(i<0) return res.status(404).json({error:"Produit introuvable."});
  db.products.splice(i,1); saveDB(); res.json({ok:true});
});
app.get("/api/admin/categories", requireAuth, requireAdmin, (req,res) => res.json([...new Set(db.products.map(p=>p.category))].sort()));
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
app.post("/api/admin/uploads", requireAuth, requireAdmin, imageUpload.single("image"), async (req,res) => {
  if (!req.file) return res.status(400).json({error:"Sélectionnez une image JPG, PNG, WEBP ou AVIF."});
  if (!cloudinaryConfigured) return res.status(503).json({error:"Stockage d'images non configuré. Ajoutez les identifiants Cloudinary dans les variables d'environnement."});
  try {
    const result = await uploadToCloudinary(req.file.buffer);
    res.status(201).json({url:result.secure_url, publicId:result.public_id});
  } catch (err) {
    console.error("Cloudinary upload:", err.message);
    res.status(502).json({error:"Le stockage externe n'a pas accepté l'image."});
  }
});

app.post("/api/admin/products", requireAuth, requireAdmin, (req,res) => {
  const p=req.body || {};
  if (!validText(String(p.name || ""), 160) || !validText(String(p.category || ""), 80) || !Number.isFinite(Number(p.price)) || Number(p.price) < 0 || Number(p.price) > 10000000 || Number(p.stock || 0) < 0) return res.status(400).json({error:"Nom, catégorie, prix et stock valides requis."});
  if (p.imageUrl) { try { if (new URL(p.imageUrl).protocol !== "https:") throw new Error(); } catch { return res.status(400).json({error:"L’URL de l’image doit être une adresse HTTPS valide."}); } }
  const product={id:String(p.id || crypto.randomUUID()),name:String(p.name),category:String(p.category),price:Number(p.price),oldPrice:Number(p.oldPrice || p.price),stock:Number(p.stock || 0),rating:0,sold:0,emoji:p.emoji || "🛍️",description:String(p.description || ""),colors:Array.isArray(p.colors)?p.colors:[],featured:false,imageUrl:typeof p.imageUrl === "string" ? p.imageUrl : ""};
  if (db.products.some(x=>x.id===product.id)) return res.status(409).json({error:"Identifiant déjà utilisé."});
  db.products.push(product); saveDB(); res.status(201).json(product);
});

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
app.post("/api/payments/checkout", requireAuth, async (req,res) => {
  if (!stripe) return res.status(503).json({error:"Le paiement par carte n'est pas encore activé. Configurez les clés du prestataire dans .env."});
  const error=validateOrder({...req.body,paymentMethod:"stripe"});
  if (error) return res.status(400).json({error});
  const lines=orderDetails(req.body.items);
  try {
    const checkout=await stripe.checkout.sessions.create({
      mode:"payment",
      line_items:lines.map(x=>({quantity:x.quantity,price_data:{currency:"mad",unit_amount:Math.round(x.price*100),product_data:{name:x.name}}})),
      success_url:`${BASE_URL}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${BASE_URL}/?payment=cancelled`,
      metadata:{userId:req.session.userId,orderItems:JSON.stringify(req.body.items),customer:String(req.body.customer),address:String(req.body.address),city:String(req.body.city),phone:String(req.body.phone)}
    });
    res.json({url:checkout.url});
  } catch(e) { console.error("Stripe checkout:",e.message); res.status(502).json({error:"Le prestataire de paiement n'a pas pu créer la session."}); }
});
app.post("/api/payments/webhook", async (req,res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send("Webhook non configuré");
  let event;
  try { event=stripe.webhooks.constructEvent(req.body,req.headers["stripe-signature"],process.env.STRIPE_WEBHOOK_SECRET); }
  catch(err) { return res.status(400).send(`Webhook invalide: ${err.message}`); }
  if (event.type==="checkout.session.completed") {
    const sessionObj=event.data.object;
    const m=sessionObj.metadata || {};
    if (m.userId && m.orderItems) {
      const items=JSON.parse(m.orderItems);
      const already=db.orders.some(o=>o.paymentSessionId===sessionObj.id);
      if (!already) {
        const lines=orderDetails(items);
        const total=lines.reduce((s,x)=>s+x.price*x.quantity,0);
        const order={id:"ZY-"+Date.now().toString(36).toUpperCase(),userId:m.userId,items:lines,total,currency:"MAD",customer:m.customer,address:m.address,city:m.city,phone:m.phone,paymentMethod:"card",status:"paid",paymentSessionId:sessionObj.id,createdAt:new Date().toISOString()};
        for (const line of lines) { const p=db.products.find(x=>x.id===line.id); if (p) p.stock=Math.max(0,p.stock-line.quantity); }
        db.orders.push(order); saveDB();
      }
    }
  }
  res.json({received:true});
});

app.use(express.static(path.join(__dirname,"public")));
app.get("*", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
if (require.main === module) {
  app.listen(PORT, ()=>console.log(`ZAYNO v1.2 est disponible sur ${BASE_URL}`));
}
module.exports = { app, db, saveDB };
