const express = require("express")
const expressPromiseRouter = require("express-promise-router")
const cookieSession = require("cookie-session")
const flash = require("connect-flash")
const dateFns = require("date-fns")
const crypto = require("crypto")

const search = require("./search.js")
const crawler = require("./crawler.js")
const log = require("./log.js")
const DB = require("./db.js")
const util = require("./util.js")
const config = require("./config.js")

setInterval(() => crawler.crawlRandom, config("crawler.crawl_delay", 1000))

const server = express()
server.use("/dist", express.static("dist"))
server.use(express.urlencoded({ extended: true }))
server.use(cookieSession({
    name: `${util.applicationName}:session`,
    secret: config("security.session_secret")
}))
server.use(flash())
server.use((req, res, next) => {
    res.locals.flashes = req.flash()
    next()
})
server.use((err, req, res, next) => {
    if (res.headersSent) { return next(err) }
    req.flash("error", err.stack)
    res.redirect("/")
})

const app = expressPromiseRouter()

app.get("/", async (req, res) => {
    res.render("index", { title: "Search" })
})

const flashError = (req, res, error, redirect) => {
    req.flash("error", error)
    res.redirect(redirect)
}

app.get("/login", async (req, res) => {
    res.render("login", { title: "Login", searchForm: false })
})

app.post("/login", async (req, res) => {
    if (!req.body.password) { flashError(req, res, "No password provided.", "/login") }
    if (crypto.createHash("sha256").update(req.body.password).digest("hex") !== config("security.password_hash")) { flashError(req, res, "Invalid password provided.", "/login") }
    req.session.authed = true
    req.session.save()
    log.info("User logged in")
    res.redirect("/admin")
})

app.use("/admin", (req, res, next) => {
    if (!req.session || !req.session.authed) {
        return flashError(req, res, "Login required to access admin page.", "/login")
    }
    next()
})

app.get("/admin", async (req, res) => {
    res.render("admin", { title: "Admin" })
})

const listDomainsQuery = DB.prepare(`SELECT * FROM domains`)

app.get("/admin/domains", async (req, res) => {
    const domains = listDomainsQuery.all()
    domains.forEach(domain => { domain.enabled = util.numToBool(domain.enabled) })
    res.render("domains-list", { title: "Configure Domains", domains })
})

app.post("/admin/domains", async (req, res) => {
    if (!req.body.domain) { flashError(req, res, "No domain provided.", "/admin/domains") }
    const enable = req.body.enable === "on" ? true : false
    crawler.setDomainEnabled(req.body.domain, enable)
    req.flash("info", `${enable ? "Enabled" : "Disabled"} crawling of domain ${req.body.domain}.`)
    res.redirect("/admin/domains")
})

app.post("/admin/crawl", async (req, res) => {
    if (!req.body.url) { flashError(req, res, "No URL provided.", "/admin") }
    try {
        const url = new URL(req.body.url)
        crawler.addToCrawlQueue(url)
        log.info(`Queueing ${url}`)
        req.flash("info", `Added ${url} to queue.`)
    } catch(e) {
        if (e.code === "ERR_INVALID_URL") { req.flash("error", `${req.body.url} is an invalid URL.`) }
        else { throw e }
    }
    res.redirect("/admin")
})

app.post("/admin/logout", async (req, res) => {
    req.session.authed = false
    req.session.save()
    log.info("User logged out")
    res.redirect("/")
})

app.post("/search", async (req, res) => {
    const results = search(req.body.query)
    results.list.forEach(x => { x.updated = dateFns.format(x.updated, "HH:mm:ss dd/MM/yyyy") })
    res.render("search-results", { title: `"${req.body.query}" search results`, results })
})

server.locals.package = util.package

server.use(app)

const port = config("server.port", 5390)
server.set("view engine", "pug")
server.set("trust proxy", "loopback")
server.listen(port, () => log.info(`Running on http://localhost:${port}`))