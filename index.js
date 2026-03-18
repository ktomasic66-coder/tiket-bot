// ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â¹ prvo uÃƒâ€žÃ‚Âitaj .env  
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
let mysql = null;
try {
  mysql = require('mysql2/promise');
} catch {
  mysql = null;
}

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
} = require('discord.js');

const commands = require('./commands');

// ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â¹ ENV varijable
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID?.trim();

const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID; // rola za support
const PLAYER_ROLE_ID = '1238209853009297560';
// secret za Farming Server webhooks
const FS_WEBHOOK_SECRET = process.env.FS_WEBHOOK_SECRET;
const BLACKLIST_LOG_CHANNEL_ID = '1483576763811364935';
const BLACKLIST_ROLE_ID = '1483578948611866714';

// =====================
//  "DB" PREKO JSON FAJLA (za dashboard: welcome/logging/embeds/tickets)
// =====================

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const dbFile = path.join(dbDir, 'db.json');
let dbPool = null;
let useMySql = false;


// default postavke za ticket sistem (za dashboard)
const DEFAULT_TICKET_SYSTEM = {
  logChannelId: '',               // gdje idu transkripti
  categoryId: '',                 // kategorija za tikete
  supportRoleId: '',              // support rola (ako ?eli? override env-a)
  launcherChannelId: '1481028377489047613',
  autoCloseHours: 48,             // nakon koliko sati neaktivnosti se auto zatvara
  reminderHours: 3,               // svakih koliko minuta ide podsjetnik
  types: {
    igranje: {
      title: 'Igranje na serveru',
      questions: [
        'Koliko ?esto planira? igrati na serveru?',
        'U koje vrijeme si naj?e??e aktivan?',
        'Za?to ?eli? igrati ba? na na?em serveru?',
        'Jesi li spreman po?tovati pravila, dogovore i obaveze na farmi?',
      ],
    },
    zalba: {
      title: '?alba na igra?e',
      questions: [
        'Ime igra?a na kojeg se ?ali??',
        'Vrijeme i detaljan opis situacije?',
        'Ima? li dokaze (slike, video, log)?',
      ],
    },
    modovi: {
      title: 'Edit modova',
      questions: [
        'Na ?emu trenutno radi??',
        'Koji je konkretan problem?',
        'Koji editor / verziju igre koristi??',
      ],
    },
    pomoc: {
      title: 'Pomo?',
      questions: [
        'U ?emu ti treba pomo??',
        'Je li problem hitan?',
        'Na koga ili na ?to se odnosi problem?',
        'Dodaj detalje da admin zna ?to treba pogledati',
      ],
    },
  },
  messages: {
    reminder:
      'Hej {user}!\n' +
      'Još uvijek nisi odgovorio na pitanja iz prve poruke u tiketu.\n\n' +
      'Molimo te da se vratiš na početnu poruku i odgovoriš na sva pitanja, kako bismo mogli nastaviti s procesom.',
    autoClose:
      'Ticket je automatski zatvoren jer 48 sati nije bilo aktivnosti. Ako i dalje trebaš pomoć, slobodno otvori novi ticket.',
    igranjeWelcomeTitle: 'Dobrodošao/la na Slavonsku Ravnicu!',
    igranjeWelcomeBody:
      'Bok i dobrodošao na Slavonsku Ravnicu! 🚜\n' +
      'Ticket ti je prošao i primljen/a si na server.\n\n' +
      'Za ulazak u igru idi u kanal {launcherChannel} i tamo skini naš launcher jer unutra ti sve piše i to je glavni način za ulazak na server.\n\n' +
      'Ako želiš, modove možeš dodati i ručno preko ovog linka:\n' +
      'http://176.57.169.250:8620/mods.html?lang=en\n\n' +
      'Samo imaj na umu da će se sva buduća ažuriranja prikazivati isključivo kroz launcher, tako da više nećemo posebno lijepiti linkove za nove ili ažurirane modove. Zato ti je launcher ubuduće glavno mjesto za sve updateove.\n\n' +
      'Ako ti bilo što zapne oko instalacije, modova ili ulaska u igru, slobodno se javi.\n' +
      'Vidimo se na farmi. 🌾',
    igranjeRulesTitle: 'Pravila servera',
    igranjeRulesBody:
      'Molimo te da pročitaš pravila servera prije početka igre.\n\n' +
      '• Poštuj sve igrače na serveru\n' +
      '• Zabranjeno je uništavanje tuđe imovine\n' +
      '• Ne ostavljaj vozila na cesti\n' +
      '• Koristi samo svoja polja i farmu\n' +
      '• Exploit/cheat = trajni ban\n' +
      '• Slušaj upute admina i moderatora\n\n' +
      'Kršenje pravila rezultira opomenom, kickom ili banom. ⚠️',
    igranjeLauncherTitle: 'Launcher -- preuzimanje i instalacija',
    igranjeLauncherBody:
      'Naš launcher je glavni način za ulazak na server.\n\n' +
      '**Gdje preuzeti?**\n' +
      'Idi u kanal {launcherChannel} i preuzmi launcher.\n\n' +
      '**Kako radi?**\n' +
      '• Pokreni launcher\n' +
      '• Automatski će preuzeti sve potrebne modove\n' +
      '• Klikni "Play" i igra te prebacuje na server\n\n' +
      '**Problemi?**\n' +
      '• Pokreni launcher kao Administrator\n' +
      '• Provjeri da ti antivirus ne blokira\n' +
      '• Ako ništa ne pomaže, javi se u support kanal',
  },
};

// ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â¹ default polja za Farming zadatke (prebacujemo iz koda u db.json)
const DEFAULT_FARMING_FIELDS = [];

// default sezonski podaci za sjetvu
const DEFAULT_SOWING_SEASONS = [];


function getDefaultData() {
  return {
    welcome: {
      channelId: '',
      message: 'DobrodoÃƒâ€¦Ã‚Â¡ao {user} na server!',
    },
    logging: {
      channelId: '',
    },
    embeds: [],
    ticketBlacklist: [],
    ticketSubmissions: [],
    ticketRecords: [],
    ticketSystem: JSON.parse(JSON.stringify(DEFAULT_TICKET_SYSTEM)),
    // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â¹ ovdje Ãƒâ€žÃ¢â‚¬Â¡emo spremati aktivne/zavrÃƒâ€¦Ã‚Â¡ene FS zadatke (da ih moÃƒâ€¦Ã‚Â¾emo naÃƒâ€žÃ¢â‚¬Â¡i po polju)
    farmingTasks: [],
    farmingFields: [...DEFAULT_FARMING_FIELDS],
    sowingSeasons: [...DEFAULT_SOWING_SEASONS],   // ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ OVO NEDOSTAJE
  };
}

function mergeDbData(raw) {
  const base = getDefaultData();
  const data = raw && typeof raw === 'object' ? raw : {};

  return {
    ...base,
    ...data,
    welcome: {
      ...base.welcome,
      ...(data.welcome || {}),
    },
    logging: {
      ...base.logging,
      ...(data.logging || {}),
    },
    embeds: Array.isArray(data.embeds) ? data.embeds : base.embeds,
    ticketBlacklist: Array.isArray(data.ticketBlacklist)
      ? data.ticketBlacklist
      : base.ticketBlacklist,
    ticketSubmissions: Array.isArray(data.ticketSubmissions)
      ? data.ticketSubmissions
      : base.ticketSubmissions,
    ticketRecords: Array.isArray(data.ticketRecords)
      ? data.ticketRecords
      : base.ticketRecords,
    ticketSystem: {
      ...base.ticketSystem,
      ...(data.ticketSystem || {}),
      types: {
        igranje: {
          ...base.ticketSystem.types.igranje,
          ...(data.ticketSystem?.types?.igranje || {}),
        },
        zalba: {
          ...base.ticketSystem.types.zalba,
          ...(data.ticketSystem?.types?.zalba || {}),
        },
        modovi: {
          ...base.ticketSystem.types.modovi,
          ...(data.ticketSystem?.types?.modovi || {}),
        },
        pomoc: {
          ...base.ticketSystem.types.pomoc,
          ...(data.ticketSystem?.types?.pomoc || {}),
        },
      },
      messages: {
        ...base.ticketSystem.messages,
        ...(data.ticketSystem?.messages || {}),
      },
    },
    farmingTasks: Array.isArray(data.farmingTasks) ? data.farmingTasks : base.farmingTasks,
    farmingFields: Array.isArray(data.farmingFields) ? data.farmingFields : base.farmingFields,
    sowingSeasons: Array.isArray(data.sowingSeasons) ? data.sowingSeasons : base.sowingSeasons,
  };
}

function readLocalDb() {
  try {
    const raw = fs.readFileSync(dbFile, 'utf8');
    return mergeDbData(JSON.parse(raw));
  } catch {
    const def = mergeDbData(getDefaultData());
    fs.writeFileSync(dbFile, JSON.stringify(def, null, 2));
    return def;
  }
}

let dbCache = readLocalDb();

async function persistDbCache() {
  if (!useMySql || !dbPool) return;

  await dbPool.query(
    `INSERT INTO bot_config (config_key, config_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    ['ticket-bot', JSON.stringify(dbCache, null, 2)]
  );
}

async function initMySql() {
  if (!mysql) {
    console.log('mysql2 nije dostupan, bot ostaje na lokalnom JSON storageu.');
    return;
  }

  const mysqlUrl =
    process.env.MYSQL_URL ||
    process.env.MYSQL_PRIVATE_URL ||
    process.env.MYSQL_PUBLIC_URL ||
    '';
  const mysqlHost = process.env.MYSQLHOST || '';
  const mysqlPort = Number(process.env.MYSQLPORT || 3306);
  const mysqlUser = process.env.MYSQLUSER || '';
  const mysqlPassword = process.env.MYSQLPASSWORD || '';
  const mysqlDatabase = process.env.MYSQLDATABASE || '';

  if (!mysqlUrl && !mysqlHost) {
    console.log('MYSQL nije postavljen, bot ostaje na lokalnom JSON storageu.');
    return;
  }

  try {
    dbPool = mysqlUrl
      ? mysql.createPool(mysqlUrl)
      : mysql.createPool({
          host: mysqlHost,
          port: mysqlPort,
          user: mysqlUser,
          password: mysqlPassword,
          database: mysqlDatabase,
          connectionLimit: 8,
          waitForConnections: true,
          queueLimit: 0,
        });

    await dbPool.query('SELECT 1');
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS bot_config (
        config_key VARCHAR(80) PRIMARY KEY,
        config_value LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS ticket_submissions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(40) NOT NULL,
        user_id VARCHAR(40) NOT NULL,
        username VARCHAR(120) NOT NULL,
        ticket_type VARCHAR(80) NOT NULL,
        status VARCHAR(40) NOT NULL,
        age INT NULL,
        is_adult TINYINT(1) NOT NULL DEFAULT 0,
        channel_id VARCHAR(40) NULL,
        questions_json LONGTEXT NOT NULL,
        answers_text LONGTEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS ticket_records (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(40) NOT NULL,
        user_id VARCHAR(40) NOT NULL,
        username VARCHAR(120) NOT NULL,
        ticket_type VARCHAR(80) NOT NULL,
        ticket_title VARCHAR(120) NOT NULL,
        status VARCHAR(40) NOT NULL,
        age INT NULL,
        is_adult TINYINT(1) NOT NULL DEFAULT 0,
        channel_id VARCHAR(40) NOT NULL,
        channel_name VARCHAR(120) NOT NULL,
        claimed_by_id VARCHAR(40) NULL,
        claimed_by_tag VARCHAR(120) NULL,
        closed_by_id VARCHAR(40) NULL,
        closed_by_tag VARCHAR(120) NULL,
        close_reason VARCHAR(80) NULL,
        questions_json LONGTEXT NOT NULL,
        answers_json LONGTEXT NOT NULL,
        answers_text LONGTEXT NOT NULL,
        transcript_text LONGTEXT NULL,
        opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        claimed_at TIMESTAMP NULL DEFAULT NULL,
        closed_at TIMESTAMP NULL DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_ticket_channel (channel_id)
      )
    `);
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS ticket_blacklist (
        guild_id VARCHAR(40) NOT NULL,
        user_id VARCHAR(40) NOT NULL,
        added_by_id VARCHAR(40) NULL,
        reason VARCHAR(255) NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, user_id)
      )
    `);

    const [rows] = await dbPool.query(
      'SELECT config_value FROM bot_config WHERE config_key = ? LIMIT 1',
      ['ticket-bot']
    );

    if (rows.length) {
      dbCache = mergeDbData(JSON.parse(rows[0].config_value));
    } else {
      dbCache = readLocalDb();
      await persistDbCache();
    }

    useMySql = true;
    await migrateLegacyTicketBlacklist();
    console.log('Bot koristi zajedniÃƒâ€žÃ‚Âki MySQL storage.');
  } catch (err) {
    console.log('Bot MySQL init error, ostajem na JSON storageu:', err.message);
    useMySql = false;
    dbPool = null;
  }
}

function loadDb() {
  return JSON.parse(JSON.stringify(dbCache));
}

function saveDb(data) {
  dbCache = mergeDbData(data);
  fs.writeFileSync(dbFile, JSON.stringify(dbCache, null, 2));
  persistDbCache().catch((err) => {
    console.log('BOT CONFIG SAVE ERROR:', err.message);
  });
}

function getLocalTicketBlacklist() {
  const data = loadDb();
  return Array.isArray(data.ticketBlacklist) ? data.ticketBlacklist : [];
}

async function migrateLegacyTicketBlacklist() {
  if (!useMySql || !dbPool) return;

  const data = loadDb();
  const legacyEntries = Array.isArray(data.ticketBlacklist) ? data.ticketBlacklist : [];
  if (!legacyEntries.length) return;

  for (const entry of legacyEntries) {
    if (!entry?.userId) continue;

    await dbPool.query(
      `INSERT INTO ticket_blacklist (guild_id, user_id, added_by_id, reason, added_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         added_by_id = VALUES(added_by_id),
         reason = VALUES(reason),
         added_at = VALUES(added_at)`,
      [
        guildId || '',
        String(entry.userId),
        entry.addedBy ? String(entry.addedBy) : null,
        entry.reason ? String(entry.reason) : null,
        entry.addedAt ? new Date(entry.addedAt) : new Date(),
      ]
    );
  }

  data.ticketBlacklist = [];
  saveDb(data);
}

async function getTicketBlacklistEntry(guildIdValue, userId) {
  const normalizedGuildId = String(guildIdValue || guildId || '');
  const normalizedUserId = String(userId);

  if (useMySql && dbPool) {
    const [rows] = await dbPool.query(
      `SELECT guild_id, user_id, added_by_id, reason, added_at
       FROM ticket_blacklist
       WHERE guild_id = ? AND user_id = ?
       LIMIT 1`,
      [normalizedGuildId, normalizedUserId]
    );

    if (rows.length) {
      return {
        guildId: rows[0].guild_id,
        userId: rows[0].user_id,
        addedBy: rows[0].added_by_id || '',
        reason: rows[0].reason || '',
        addedAt: rows[0].added_at ? new Date(rows[0].added_at).toISOString() : null,
      };
    }

    return null;
  }

  return (
    getLocalTicketBlacklist().find((entry) => entry.userId === normalizedUserId) || null
  );
}

async function addUserToTicketBlacklist({ guildId: guildIdValue, userId, addedBy, reason = '' }) {
  const normalizedGuildId = String(guildIdValue || guildId || '');
  const normalizedUserId = String(userId);
  const nextEntry = {
    guildId: normalizedGuildId,
    userId: normalizedUserId,
    addedBy: addedBy ? String(addedBy) : '',
    reason: String(reason || '').trim(),
    addedAt: new Date().toISOString(),
  };

  if (useMySql && dbPool) {
    await dbPool.query(
      `INSERT INTO ticket_blacklist (guild_id, user_id, added_by_id, reason, added_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         added_by_id = VALUES(added_by_id),
         reason = VALUES(reason),
         added_at = VALUES(added_at)`,
      [
        nextEntry.guildId,
        nextEntry.userId,
        nextEntry.addedBy || null,
        nextEntry.reason || null,
        new Date(nextEntry.addedAt),
      ]
    );

    return nextEntry;
  }

  const data = loadDb();
  const blacklist = Array.isArray(data.ticketBlacklist) ? data.ticketBlacklist : [];
  const existingIndex = blacklist.findIndex((entry) => entry.userId === normalizedUserId);

  if (existingIndex >= 0) {
    blacklist[existingIndex] = {
      ...blacklist[existingIndex],
      ...nextEntry,
    };
  } else {
    blacklist.push(nextEntry);
  }

  data.ticketBlacklist = blacklist;
  saveDb(data);

  return nextEntry;
}

async function removeUserFromTicketBlacklist(guildIdValue, userId) {
  const normalizedGuildId = String(guildIdValue || guildId || '');
  const normalizedUserId = String(userId);

  if (useMySql && dbPool) {
    const [result] = await dbPool.query(
      'DELETE FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?',
      [normalizedGuildId, normalizedUserId]
    );
    return result.affectedRows > 0;
  }

  const data = loadDb();
  const blacklist = Array.isArray(data.ticketBlacklist) ? data.ticketBlacklist : [];
  const nextBlacklist = blacklist.filter((entry) => entry.userId !== normalizedUserId);
  const removed = nextBlacklist.length !== blacklist.length;

  if (removed) {
    data.ticketBlacklist = nextBlacklist;
    saveDb(data);
  }

  return removed;
}

// helper: vraÃƒâ€žÃ¢â‚¬Â¡a ticket config = default + ono Ãƒâ€¦Ã‚Â¡to je u db.json
function getTicketConfig() {
  const data = loadDb();
  const cfg = data.ticketSystem || {};

  const merged = {
    // ako u configu nema ID, koristi hard-coded konstante niÃƒâ€¦Ã‚Â¾e (TICKET_CATEGORY_ID / TICKET_LOG_CHANNEL_ID)
    logChannelId: cfg.logChannelId || TICKET_LOG_CHANNEL_ID || DEFAULT_TICKET_SYSTEM.logChannelId,
    categoryId: cfg.categoryId || TICKET_CATEGORY_ID || DEFAULT_TICKET_SYSTEM.categoryId,
    supportRoleId: cfg.supportRoleId || SUPPORT_ROLE_ID || DEFAULT_TICKET_SYSTEM.supportRoleId,
    launcherChannelId:
      cfg.launcherChannelId || DEFAULT_TICKET_SYSTEM.launcherChannelId,
    autoCloseHours:
      typeof cfg.autoCloseHours === 'number'
        ? cfg.autoCloseHours
        : DEFAULT_TICKET_SYSTEM.autoCloseHours,
    reminderHours:
      typeof cfg.reminderHours === 'number'
        ? cfg.reminderHours
        : DEFAULT_TICKET_SYSTEM.reminderHours,
    types: {
      igranje: {
        ...DEFAULT_TICKET_SYSTEM.types.igranje,
        ...(cfg.types?.igranje || {}),
      },
      zalba: {
        ...DEFAULT_TICKET_SYSTEM.types.zalba,
        ...(cfg.types?.zalba || {}),
      },
      modovi: {
        ...DEFAULT_TICKET_SYSTEM.types.modovi,
        ...(cfg.types?.modovi || {}),
      },
      pomoc: {
        ...DEFAULT_TICKET_SYSTEM.types.pomoc,
        ...(cfg.types?.pomoc || {}),
      },
    },
    messages: {
      ...DEFAULT_TICKET_SYSTEM.messages,
      ...(cfg.messages || {}),
    },
  };

  return merged;
}

// helper: vraÃƒâ€žÃ¢â‚¬Â¡a listu polja za Farming zadatke
function getFarmingFields() {
  const data = loadDb();
  const arr = data.farmingFields;
  if (Array.isArray(arr) && arr.length) {
    return arr.map(String);
  }
  return [...DEFAULT_FARMING_FIELDS];
}

// helper: spremi polja u db.json
function saveFarmingFields(fields) {
  const data = loadDb();
  data.farmingFields = Array.from(new Set(fields.map(String)));
  saveDb(data);
}

// =====================
//  SOWING SEASON SYSTEM ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ DB + HELPERS
// =====================

// ID kanala gdje ide Ãƒâ€¦Ã‚Â¾iva embed poruka
const SOWING_SEASON_CHANNEL_ID = "1437698436068671528";

// uÃƒâ€žÃ‚Âitaj ili kreiraj listu sezona
function getSowingSeasons() {
  const data = loadDb();

  if (!Array.isArray(data.sowingSeasons)) {
    data.sowingSeasons = [];
    saveDb(data); // ÃƒÂ¢Ã¢â‚¬Â Ã‚Â kljuÃƒâ€žÃ‚Âna linija
  }

  return data.sowingSeasons;
}


function saveSowingSeasons(list) {
  const data = loadDb();
  data.sowingSeasons = list;
  saveDb(data);
}

// kreira praznu novu sezonu
function createNewSeason() {
  const seasons = getSowingSeasons();
  const number = seasons.length + 1;

  const newSeason = {
    season: number,
    messageId: null,
    completed: false,
    fields: {}, // "36": "jeÃƒâ€žÃ‚Âam"
    createdAt: Date.now(),
  };

  seasons.push(newSeason);
  saveSowingSeasons(seasons);

  return newSeason;
}

// uzmi aktivnu sezonu ili kreiraj novu
function getActiveSeason() {
    const seasons = getSowingSeasons();

    if (!seasons.length) {
        const created = createNewSeason();
        return created;
    }

    const last = seasons[seasons.length - 1];

    if (last.completed) {
        const newSeason = createNewSeason();
        return newSeason;
    }

    return last;
}


// generisanje progress bara
function makeSeasonProgressBar(current, total) {
  const percent = Math.round((current / total) * 100);
  const filledCount = Math.round(percent / 10);
  const emptyCount = 10 - filledCount;
  return "ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â°".repeat(filledCount) + "ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â±".repeat(emptyCount) + ` ${percent}%`;
}

// update ili kreiranje embed poruke u sezoni
async function updateSeasonEmbed(guild, forceEmpty = false) {
  const season = getActiveSeason();
  const fields = getFarmingFields();
  const total = fields.length;
  const sownCount = Object.keys(season.fields).length;

  const channel = await guild.channels
    .fetch(SOWING_SEASON_CHANNEL_ID)
    .catch(() => null);

  if (!channel) return;

  // -------------------------------------------------------
  // 1ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÂ¢Ã†â€™Ã‚Â£ FORCE RESET MODE ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ prazan embed bez polja
  // -------------------------------------------------------
  if (forceEmpty === true) {
    const emptyEmbed = new EmbedBuilder()
      .setColor("#3ba55d")
      .setTitle(`ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ Sezona Sjetve #${season.season}`)
      .setDescription("_JoÃƒâ€¦Ã‚Â¡ nema posijanih polja..._")
      .addFields({
        name: "Progres",
        value: `0/${total}\n${makeSeasonProgressBar(0, total)}`
      })
      .setTimestamp();

    // Ako embed postoji, osvjeÃƒâ€¦Ã‚Â¾i ga
    if (season.messageId) {
      const msg = await channel.messages.fetch(season.messageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [emptyEmbed] });
        return;
      }
    }

    // ili kreiraj novi embed ako ga nema
    const sent = await channel.send({ embeds: [emptyEmbed] });
    season.messageId = sent.id;

    const seasons = getSowingSeasons();
    const idx = seasons.findIndex(s => s.season === season.season);
    if (idx !== -1) {
      seasons[idx] = season;
      saveSowingSeasons(seasons);
    }

    return;
  }

  // -------------------------------------------------------
  // 2ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÂ¢Ã†â€™Ã‚Â£ NORMALNI MODE ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ prikaz samo posijanih polja
  // -------------------------------------------------------
  const lines = [];

  for (const f of fields) {
    if (season.fields[f]) {
      lines.push(`**Polje ${f}** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${season.fields[f]}`);
    }
  }


  if (lines.length === 0) {
    lines.push("_JoÃƒâ€¦Ã‚Â¡ nema posijanih polja..._");
  }


  const progress = makeSeasonProgressBar(sownCount, total);

  const embed = new EmbedBuilder()
    .setColor("#3ba55d")
    .setTitle(`ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ Sezona Sjetve #${season.season}`)
    .setDescription(lines.join("\n"))
    .addFields({
      name: "Progres",
      value: `${sownCount}/${total}\n${progress}`,
    })
    .setTimestamp();

  // Ako embed joÃƒâ€¦Ã‚Â¡ ne postoji ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â kreiraj ga
  if (!season.messageId) {
    const sent = await channel.send({ embeds: [embed] });
    season.messageId = sent.id;

    const seasons = getSowingSeasons();
    const idx = seasons.findIndex(s => s.season === season.season);
    if (idx !== -1) {
      seasons[idx] = season;
      saveSowingSeasons(seasons);
    }
    return;
  }

  // InaÃƒâ€žÃ‚Âe ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â osvjeÃƒâ€¦Ã‚Â¾i embed
  const msg = await channel.messages.fetch(season.messageId).catch(() => null);

  if (!msg) {
    const sent = await channel.send({ embeds: [embed] });
    season.messageId = sent.id;

    const seasons = getSowingSeasons();
    const idx = seasons.findIndex(s => s.season === season.season);
    if (idx !== -1) {
      seasons[idx] = season;
      saveSowingSeasons(seasons);
    }

    return;
  }

  await msg.edit({ embeds: [embed] });

  // ZavrÃƒâ€¦Ã‚Â¡etak sezone
  if (sownCount >= total && !season.completed) {
    season.completed = true;
    saveSowingSeasons(getSowingSeasons());

    const doneEmbed = EmbedBuilder.from(embed)
      .setColor("#ffcc00")
      .setTitle(`ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ Sezona Sjetve #${season.season} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ÃƒÂ¢Ã…â€œÃ¢â‚¬Â ZavrÃƒâ€¦Ã‚Â¡ena`);

    await msg.edit({ embeds: [doneEmbed] });


    createNewSeason();
  }
}

// =====================
//  SOWING ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ Upis polja u sezonu
// =====================
async function handleNewSowingTask(guild, field, cropName) {
    const seasons = getSowingSeasons();
    let season = getActiveSeason();

    // pronaÃƒâ€žÃ¢â‚¬Ëœi pravi season objekt
    const idx = seasons.findIndex(s => s.season === season.season);
    if (idx === -1) {
        console.log("ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Sezona nije pronaÃƒâ€žÃ¢â‚¬Ëœena u listi!");
        return;
    }

    // upis kulture
    seasons[idx].fields[field] = cropName;

    // spremi u db.json
    saveSowingSeasons(seasons);

    console.log(`ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â± Upis sjetve ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Sezona ${season.season}, Polje ${field}: ${cropName}`);

    // osvjeÃƒâ€¦Ã‚Â¾avanje embeda
    await updateSeasonEmbed(guild);
}





// inicijaliziraj db.json ako ne postoji
saveDb(loadDb());

// =====================
//  EXPRESS + DASHBOARD
// =====================

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
// za JSON body (webhookovi s FS servera)
app.use(express.json());

app.use(
  session({
    secret: process.env.DASHBOARD_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
  })
);

// ÃƒÂ°Ã…Â¸Ã‚Â§Ã‚Â® helper za lijepi uptime
function formatUptime(ms) {
  if (!ms) return 'N/A';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length) parts.push('manje od 1 minute');
  return parts.join(' ');
}

// root -> /dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// glavni dashboard
app.get('/dashboard', async (req, res) => {
  const activeTab = req.query.tab || 'overview';

  let guild = null;
  try {
    guild = await client.guilds.fetch(guildId);
  } catch (e) {
    console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ Ne mogu fetchati guild:', guildId, e.message);
  }

  console.log(
    'Dashboard guild:',
    guild ? guild.name : 'NEMA GUILDA',
    'ID:',
    guildId
  );

  const botData = {
    tag: client.user ? client.user.tag : 'Bot offline',
    id: client.user ? client.user.id : 'N/A',
    avatar: client.user ? client.user.displayAvatarURL() : null,
    uptime: formatUptime(client.uptime),
    readyAt: client.readyAt || null,
  };

  const guildData = guild
    ? {
        name: guild.name,
        memberCount: guild.memberCount,
        id: guild.id,
      }
    : {
        name: 'Guild nije uÃƒâ€žÃ‚Âitan',
        memberCount: 'N/A',
        id: guildId,
      };

  let channels = [];
  if (guild) {
    try {
      await guild.channels.fetch();

      channels = guild.channels.cache
        .filter(
          (c) =>
            c.type === ChannelType.GuildText ||
            c.type === ChannelType.GuildAnnouncement
        )
        .map((c) => ({
          id: c.id,
          name: c.name,
        }));
    } catch (e) {
      console.log('ÃƒÂ¢Ã‚ÂÃ…â€™ GreÃƒâ€¦Ã‚Â¡ka pri fetchanju kanala:', e.message);
    }
  }

  console.log('Broj kanala za dropdown:', channels.length);

  const config = loadDb();

  res.render('dashboard', {
    bot: botData,
    guild: guildData,
    config,
    activeTab,
    channels,
  });
});

// --------------- GREETINGS (WELCOME) mesage ---------------
app.post('/dashboard/greetings', (req, res) => {
  const { welcomeChannelId, welcomeMessage } = req.body;

  const data = loadDb();
  data.welcome.channelId = welcomeChannelId || '';
  data.welcome.message =
    welcomeMessage && welcomeMessage.trim().length
      ? welcomeMessage
      : 'DobrodoÃƒâ€¦Ã‚Â¡ao {user} na server!';
  saveDb(data);

  res.redirect('/dashboard?tab=greetings');
});

// --------------- LOGGING ---------------
app.post('/dashboard/logging', (req, res) => {
  const { logChannelId } = req.body;

  const data = loadDb();
  data.logging.channelId = logChannelId || '';
  saveDb(data);

  res.redirect('/dashboard?tab=logging');
});

// --------------- EMBEDS ---------------
app.post('/dashboard/embeds', async (req, res) => {
  const {
    embedChannelId,
    normalMessage,
    title,
    description,
    color,
    footerText,
    footerIcon,
    thumbnailUrl,
    imageUrl,
    authorName,
    authorIcon,
    launcherButtonLabel,
    launcherButtonUrl,
    timestamp,
  } = req.body;

  try {
    const ch = await client.channels.fetch(embedChannelId);

    const embed = new EmbedBuilder();

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (color) embed.setColor(color);

    if (authorName || authorIcon) {
      embed.setAuthor({
        name: authorName || '',
        iconURL: authorIcon || null,
      });
    }

    if (footerText || footerIcon) {
      embed.setFooter({
        text: footerText || '',
        iconURL: footerIcon || null,
      });
    }

    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
    if (imageUrl) embed.setImage(imageUrl);

    if (timestamp === 'on') {
      embed.setTimestamp(new Date());
    }

    const components = [];
    const trimmedLauncherUrl = launcherButtonUrl?.trim();

    if (trimmedLauncherUrl) {
      components.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel(launcherButtonLabel?.trim() || 'Skini launcher')
            .setStyle(ButtonStyle.Link)
            .setURL(trimmedLauncherUrl)
        )
      );
    }

    await ch.send({
      content: normalMessage?.trim() || undefined,
      embeds: [embed],
      components,
    });

    const data = loadDb();
    data.embeds.push({
      channelId: embedChannelId,
      normalMessage,
      title,
      description,
      color,
      footerText,
      footerIcon,
      thumbnailUrl,
      imageUrl,
      authorName,
      authorIcon,
      launcherButtonLabel,
      launcherButtonUrl: trimmedLauncherUrl || '',
      timestamp: timestamp === 'on',
      sentAt: new Date().toISOString(),
    });
    saveDb(data);

    res.redirect('/dashboard?tab=embeds');
  } catch (err) {
    console.error('Embed error:', err);
    res.status(500).send('GreÃƒâ€¦Ã‚Â¡ka pri slanju embed-a: ' + err.message);
  }
});

// --------------- Ticket sustav CONFIG ---------------
app.post('/dashboard/tickets', (req, res) => {
  const data = loadDb();
  const ts = data.ticketSystem || { ...DEFAULT_TICKET_SYSTEM };

  const {
    ticketLogChannelId,
    ticketCategoryId,
    ticketSupportRoleId,
    autoCloseHours,
    reminderHours,
    igranjeQuestions,
    zalbaQuestions,
    modoviQuestions,
    pomocQuestions,
    reminderMessage,
    autoCloseMessage,
  } = req.body;

  ts.logChannelId = ticketLogChannelId || '';
  ts.categoryId = ticketCategoryId || '';
  ts.supportRoleId = ticketSupportRoleId || '';

  ts.autoCloseHours = Number(autoCloseHours) || DEFAULT_TICKET_SYSTEM.autoCloseHours;
  ts.reminderHours = Number(reminderHours) || DEFAULT_TICKET_SYSTEM.reminderHours;

  // pitanja: svaki red u textarea = jedno pitanje
  ts.types.igranje.questions = (igranjeQuestions || '')
    .split('\n')
    .map((q) => q.trim())
    .filter(Boolean);

  ts.types.zalba.questions = (zalbaQuestions || '')
    .split('\n')
    .map((q) => q.trim())
    .filter(Boolean);

  ts.types.modovi.questions = (modoviQuestions || '')
    .split('\n')
    .map((q) => q.trim())
    .filter(Boolean);

  ts.types.pomoc.questions = (pomocQuestions || '')
    .split('\n')
    .map((q) => q.trim())
    .filter(Boolean);

  ts.messages.reminder = reminderMessage || DEFAULT_TICKET_SYSTEM.messages.reminder;
  ts.messages.autoClose = autoCloseMessage || DEFAULT_TICKET_SYSTEM.messages.autoClose;

  data.ticketSystem = ts;
  saveDb(data);

  res.redirect('/dashboard?tab=tickets');
});


// =====================
//  FS WEBHOOK ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ helper za provjeru secreta
// =====================
function checkFsSecret(req, res) {
  const sent =
    req.headers['x-fs-secret'] ||
    req.headers['x-fs25-secret'] ||
    (req.body && req.body.secret);

  if (!FS_WEBHOOK_SECRET) {
    console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â FS_WEBHOOK_SECRET nije postavljen u .env ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ odbijam zahtjev.');
    res.status(500).json({ ok: false, error: 'secret_not_configured' });
    return false;
  }

  if (!sent) {
    console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â FS webhook: secret nije poslan u headeru/body-u.');
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }

  if (sent !== FS_WEBHOOK_SECRET) {
    console.warn(
      'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â FS webhook: neispravan secret. serverLen=%d, sentLen=%d',
      FS_WEBHOOK_SECRET.length,
      String(sent).length
    );
    res.status(403).json({ ok: false, error: 'invalid_secret' });
    return false;
  }

  return true;
}


// =====================
//  FS TELEMETRY ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ helper funkcije (emoji, progress bar, boje, embed)
// =====================

function makeProgressBar(percent, size = 10) {
  const p = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const filled = Math.round((p / 100) * size);
  const empty = size - filled;
  const fullChar = 'ÃƒÂ¢Ã¢â‚¬â€œÃ‹â€ ';
  const emptyChar = 'ÃƒÂ¢Ã¢â‚¬â€œÃ¢â‚¬Ëœ';
  return fullChar.repeat(filled) + emptyChar.repeat(empty);
}

function pickVehicleEmoji(typeName = '') {
  const t = typeName.toLowerCase();
  if (t.includes('combine')) return 'ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾';
  if (t.includes('truck') || t.includes('lkw')) return 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã…Â¡';
  if (t.includes('trailer')) return 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã¢â‚¬Âº';
  if (t.includes('car') || t.includes('pickup')) return 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã¢â€žÂ¢';
  if (t.includes('telehandler') || t.includes('loader')) return 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â§';
  return 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã…â€œ';
}

function pickColorFromVehicle(v) {
  if (!v) return 0x2f3136;
  const dmg = v.damage?.damagePercent ?? 0;
  const broken = v.damage?.isBroken;

  if (broken || dmg >= 80) return 0xff0000;      // crveno ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ razbijen
  if (dmg >= 40) return 0xffa500;                // naranÃƒâ€žÃ‚Âasto ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ dosta oÃƒâ€¦Ã‚Â¡teÃƒâ€žÃ¢â‚¬Â¡en
  if (v.isOnAI) return 0xffe000;                 // Ãƒâ€¦Ã‚Â¾uto ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ AI ga vozi
  if (v.isRunning) return 0x57f287;              // zeleno ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ motor radi
  return 0x5865f2;                               // default Discord plava
}

function createTelemetryEmbed(telemetry) {
  const v = telemetry?.vehicles?.[0];

  if (!v) {
    return new EmbedBuilder()
      .setTitle('FS25 TELEMETRY')
      .setDescription('Nije pronaÃƒâ€žÃ¢â‚¬Ëœen nijedan aktivni stroj u telemetriji.')
      .setColor(0x2f3136);
  }

  const emoji = pickVehicleEmoji(v.typeName);
  const mapName = telemetry.mapName || 'Lunow';

  const speed = `${v.speedKph ?? 0} km/h`;
  const direction = v.direction || '-';

  const fieldId = v.field?.fieldId;
  const farmlandId = v.field?.farmlandId;
  const fieldText = v.field?.isOnField
    ? (fieldId ? `F${fieldId}` : farmlandId ? `farmland ${farmlandId}` : 'na polju')
    : 'izvan polja';

  // fill info ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ uzimamo prvi spremnik ako postoji
  const fill = v.fills?.[0];
  const fillPercent = fill?.percent ?? 0;
  const fillTitle = fill?.title || 'Prazno';
  const fillLine = `${fillPercent}% ${fillTitle}`;

  // gorivo
  const fuelPercent = v.fuel?.fuelPercent ?? 0;
  const defPercent = v.fuel?.defPercent ?? null;
  const fuelType = (v.fuel?.fuelType || 'fuel').toUpperCase();

  const fuelBar = makeProgressBar(fuelPercent, 12);
  const defBar = defPercent != null ? makeProgressBar(defPercent, 12) : null;

  // damage
  const damagePercent = v.damage?.damagePercent ?? 0;
  const damageBar = makeProgressBar(damagePercent, 12);

  const isRunning = v.isRunning ? 'ON' : 'OFF';
  const aiText = v.isOnAI ? 'DA' : 'NE';
  const controlledText = v.isControlled ? 'IgraÃƒâ€žÃ‚Â' : (v.isOnAI ? 'AI' : 'Nije');

  const playerName = v.playerName || 'Nepoznat';
  const farmName = v.farmName || `Farm ${v.farmId ?? '?'}`;

  // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â¹ PRVA LINIJA ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ sve u jednom redu:
  // "CLAAS TRION 750 | 8 km/h | F112 | 54% Corn"
  const summaryLine =
    `${emoji} ${v.vehicleName || 'Vozilo'} | ` +
    `${speed} | ` +
    `${fieldText} | ` +
    `ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â¦ ${fillLine}`;

  const embed = new EmbedBuilder()
    .setTitle(`FS25 TELEMETRY | ${mapName}`)
    .setDescription(summaryLine)
    .setColor(pickColorFromVehicle(v))
    .addFields(
      {
        name: 'Vozilo',
        value: [
          `**Naziv:** ${v.vehicleName || 'Nepoznato'}`,
          `**Tip:** ${v.typeName || '-'}`,
          `**IgraÃƒâ€žÃ‚Â:** ${playerName}`,
          `**Farma:** ${farmName}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Status',
        value: [
          `**Motor:** ${isRunning}`,
          `**Smjer:** ${direction}`,
          `**Brzina:** ${speed}`,
          `**AI:** ${aiText}`,
          `**Kontrola:** ${controlledText}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Gorivo ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂºÃ‚Â¢ÃƒÂ¯Ã‚Â¸Ã‚Â',
        value: [
          `**${fuelType}:** ${fuelPercent}%`,
          fuelBar,
          defBar != null ? `**DEF:** ${defPercent}%\n${defBar}` : null,
        ].filter(Boolean).join('\n'),
        inline: true,
      },
      {
        name: 'Ãƒâ€¦Ã‚Â teta',
        value: [
          `**Stanje:** ${damagePercent}%`,
          damageBar,
          v.damage?.isBroken ? 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â **Vozilo je pokvareno!**' : '',
        ].filter(Boolean).join('\n'),
        inline: true,
      },
      {
        name: 'Spremnici ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â¦',
        value: fill
          ? [
              `**${fillTitle}:** ${fillPercent}%`,
              makeProgressBar(fillPercent, 18),
              `${Math.round(fill.level || 0)}/${Math.round(fill.capacity || 0)} L`,
            ].join('\n')
          : 'Nema aktivnog punjenja.',
        inline: false,
      },
      {
        name: 'Pozicija ÃƒÂ°Ã…Â¸Ã‚Â§Ã‚Â­',
        value: [
          `X: ${v.worldPosition?.x?.toFixed(1) ?? '-'}`,
          `Z: ${v.worldPosition?.z?.toFixed(1) ?? '-'}`,
          `Y: ${v.worldPosition?.y?.toFixed(1) ?? '-'}`,
          `Polje: ${fieldText}`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({
      text: `${telemetry.modName || 'FS25_DiscordBridge'} ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ${new Date().toLocaleString('hr-HR')}`,
    });

  return embed;
}

// =====================
//  FS WEBHOOK ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ test ruta
// =====================
app.post('/fs/test', (req, res) => {
  if (!checkFsSecret(req, res)) return;

  console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â€ [FS TEST] Primljen payload:', req.body);

  res.json({ ok: true, received: req.body });
});

// =====================
//  FS WEBHOOK ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ TELEMETRY -> DISCORD EMBED
// =====================
app.post('/fs/telemetry', async (req, res) => {
  if (!checkFsSecret(req, res)) return;

  const body = req.body || {};
  const telemetry = body.telemetry || body;

  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â /fs/telemetry: guild nije uÃƒâ€žÃ‚Âitan.');
      return res.status(500).json({ ok: false, error: 'guild_not_loaded' });
    }

    const channel = await client.channels
      .fetch(FS_TELEMETRY_CHANNEL_ID)
      .catch(() => null);

    if (!channel) {
      console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â /fs/telemetry: kanal za telemetriju nije podeÃƒâ€¦Ã‚Â¡en.');
      return res
        .status(500)
        .json({ ok: false, error: 'telemetry_channel_not_configured' });
    }

    const vehicles = Array.isArray(telemetry.vehicles)
      ? telemetry.vehicles
      : [];

    // Ako nema vozila ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ simple embed
    if (vehicles.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x2f3136)
        .setTitle('FS25 TELEMETRY')
        .setDescription('Nije pronaÃƒâ€žÃ¢â‚¬Ëœen nijedan aktivni stroj u telemetriji.')
        .setTimestamp(new Date());

      await channel.send({ embeds: [embed] });
      return res.json({ ok: true, sent: true, vehicles: 0 });
    }

    // InaÃƒâ€žÃ‚Âe koristimo naÃƒâ€¦Ã‚Â¡ fancy helper s emoji + progress barovima
    const embed = createTelemetryEmbed(telemetry);
    await channel.send({ embeds: [embed] });

    return res.json({
      ok: true,
      sent: true,
      vehicles: vehicles.length,
    });
  } catch (err) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ GreÃƒâ€¦Ã‚Â¡ka u /fs/telemetry:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});




// =====================
//  FS ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ pomoÃƒâ€žÃ¢â‚¬Â¡ne funkcije za zadatke (DB)
// =====================

// spremi / update jednog zadatka u db.json
function saveFarmingTask(record) {
  const data = loadDb();
  if (!Array.isArray(data.farmingTasks)) data.farmingTasks = [];

  // ako veÃƒâ€žÃ¢â‚¬Â¡ postoji isti messageId ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ update
  const idx = data.farmingTasks.findIndex(
    (t) => t.messageId === record.messageId
  );

  if (idx !== -1) {
    data.farmingTasks[idx] = { ...data.farmingTasks[idx], ...record };
  } else {
    data.farmingTasks.push(record);
  }

  saveDb(data);
}

// pronaÃƒâ€žÃ¢â‚¬Ëœi zadatak po polju koji je joÃƒâ€¦Ã‚Â¡ "open"
function findOpenTaskByField(field) {
  const data = loadDb();
  if (!Array.isArray(data.farmingTasks)) return null;

  // traÃƒâ€¦Ã‚Â¾imo od kraja (najnoviji)
  for (let i = data.farmingTasks.length - 1; i >= 0; i--) {
    const t = data.farmingTasks[i];
    if (t.field === field && t.status === 'open') return t;
  }
  return null;
}

// oznaÃƒâ€žÃ‚Âi zadatak kao zavrÃƒâ€¦Ã‚Â¡en + prebaci embed u "zavrÃƒâ€¦Ã‚Â¡ene poslove"
// ili kreiraj novi zavrÃƒâ€¦Ã‚Â¡en zadatak ako ne postoji
async function finishTaskFromFsUpdate(field, payload) {
  const task = findOpenTaskByField(field);
  const finishedBy = payload.player || 'FS Server';
  const status = payload.status || 'finished';
  const jobFromFs = payload.job || null;

  // dohvatimo guild (tvoj glavni)
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;

  const jobChannel = await client.channels
    .fetch(FS_JOB_CHANNEL_ID)
    .catch(() => null);
  const doneChannel = await client.channels
    .fetch(FS_JOB_DONE_CHANNEL_ID)
    .catch(() => null);

  if (!doneChannel) return false;

  // ako nema spremljenog zadatka za ovo polje
  if (!task || !jobChannel) {
    const jobName = jobFromFs || `Posao sa FS (${status})`;

    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Zadatak (auto iz FS)')
      .addFields(
        { name: 'Polje', value: `Polje ${field}`, inline: true },
        { name: 'Posao', value: jobName, inline: true },
        { name: 'ZavrÃƒâ€¦Ã‚Â¡io', value: finishedBy, inline: true }
      )
      .setTimestamp();

    const msg = await doneChannel.send({ embeds: [embed] });

    saveFarmingTask({
      field,
      jobName,
      status: 'done',
      fromFs: true,
      channelId: doneChannel.id,
      messageId: msg.id,
      createdBy: null,
      createdAt: new Date().toISOString(),
      finishedBy,
      finishedAt: new Date().toISOString(),
    });

    console.log(
      `ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ FS: Nije pronaÃƒâ€žÃ¢â‚¬Ëœen aktivni zadatak za polje ${field}, kreiran novi "zavrÃƒâ€¦Ã‚Â¡en" zadatak.`
    );

    return true;
  }

  // imamo otvoreni zadatak u kanalu za poslove ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ dohvatimo stari embed
  const msg = await jobChannel.messages
    .fetch(task.messageId)
    .catch(() => null);
  if (!msg || !msg.embeds[0]) return false;

  const oldEmbed = msg.embeds[0];

  const finishedEmbed = EmbedBuilder.from(oldEmbed)
    .setColor('#ff0000')
    .setTitle('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Zadatak zavrÃƒâ€¦Ã‚Â¡en (FS)')
    .setFooter({
      text: 'OznaÃƒâ€žÃ‚Âeno kao zavrÃƒâ€¦Ã‚Â¡eno od strane: ' + finishedBy,
    })
    .setTimestamp();

  await doneChannel.send({ embeds: [finishedEmbed] });
  await msg.delete().catch(() => {});

  // update u db
  const data = loadDb();
  if (!Array.isArray(data.farmingTasks)) data.farmingTasks = [];
  const idx = data.farmingTasks.findIndex(
    (t) => t.messageId === task.messageId
  );
  if (idx !== -1) {
    data.farmingTasks[idx].status = 'done';
    data.farmingTasks[idx].finishedBy = finishedBy;
    data.farmingTasks[idx].finishedAt = new Date().toISOString();
    saveDb(data);
  }

  console.log(
    `ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ FS: Zadatak za polje ${field} automatski oznaÃƒâ€žÃ‚Âen kao zavrÃƒâ€¦Ã‚Â¡en.`
  );

  return true;
}

// =====================
//  FS WEBHOOK ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ field update (auto zavrÃƒâ€¦Ã‚Â¡avanje posla)
// =====================
app.post('/fs/field-update', async (req, res) => {
  if (!checkFsSecret(req, res)) return;

  const payload = req.body || {};
  const field = String(payload.field || '').trim();
  const status = String(payload.status || '').toLowerCase();

  console.log('ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ [FS FIELD UPDATE]', payload);

  if (!field) {
    return res.status(400).json({ ok: false, error: 'missing_field' });
  }

  const FINISHED_STATUSES = ['finished', 'done', 'harvested', 'completed'];

  if (!FINISHED_STATUSES.includes(status)) {
    return res.json({ ok: true, ignored: true, reason: 'status_not_finished' });
  }

  try {
    const success = await finishTaskFromFsUpdate(field, payload);
    if (!success) {
      return res.status(404).json({
        ok: false,
        error: 'no_task_and_failed_to_create',
      });
    }

    // ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ Ako FS zavrÃƒâ€¦Ã‚Â¡i posao koji je sijanje, zabiljeÃƒâ€¦Ã‚Â¾i ga u sezoni
try {
  const crop = payload.crop || payload.seed || null;

  if (crop) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (guild) {
      await handleNewSowingTask(guild, field, crop);
    }
  }
} catch (e) {
  console.log("ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â GreÃƒâ€¦Ã‚Â¡ka pri upisu FS sjetve u sezonu:", e);
}


    return res.json({ ok: true, finished: true });
  } catch (err) {
    console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ GreÃƒâ€¦Ã‚Â¡ka u /fs/field-update:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

initMySql().finally(() => {
  app.listen(PORT, () => {
    console.log(`ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â Dashboard listening on port ${PORT}`);
  });
});

// =====================
//  DISCORD BOT DIO
// =====================

// ÃƒÂ¢Ã‚ÂÃ¢â‚¬â€ kategorija gdje idu tiketi (default, moÃƒâ€¦Ã‚Â¾e se override-ati u dashboardu)
const TICKET_CATEGORY_ID = '1437220354992115912';

// ÃƒÂ¢Ã‚ÂÃ¢â‚¬â€ kanal gdje ide TRANSKRIPT zatvorenih tiketa  (default, moÃƒâ€¦Ã‚Â¾e se override-ati u dashboardu)
const TICKET_LOG_CHANNEL_ID = '1437218054718095410';

// ÃƒÂ¢Ã‚ÂÃ¢â‚¬â€ kanal gdje idu AKTIVNI FARMING poslovi (npr. #posao-na-farmi)
const FS_JOB_CHANNEL_ID = '1442984129699254292';

// ÃƒÂ¢Ã‚ÂÃ¢â‚¬â€ kanal gdje idu ZAVRÃƒâ€¦Ã‚Â ENI poslovi (npr. #zavrseni-poslovi)
const FS_JOB_DONE_CHANNEL_ID = '1442951254287454399';

// ÃƒÂ¢Ã‚ÂÃ¢â‚¬â€ kanal gdje idu FS25 TELEMETRY logovi (embed s vozilom)
const FS_TELEMETRY_CHANNEL_ID = process.env.FS_TELEMETRY_CHANNEL_ID || '';

async function sendBlacklistLog(guild, options) {
  if (!guild || !BLACKLIST_LOG_CHANNEL_ID) return;

  const channel = await guild.channels.fetch(BLACKLIST_LOG_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const payload =
    typeof options === 'string'
      ? formatBlacklistLogEmbedFromText(options)
      : options;

  const embed = new EmbedBuilder()
    .setColor(payload.color || '#2f3136')
    .setTitle(payload.title || 'Ticket Blacklist')
    .setTimestamp();

  if (payload.description) {
    embed.setDescription(payload.description);
  }

  if (Array.isArray(payload.fields) && payload.fields.length) {
    embed.addFields(payload.fields);
  }

  if (payload.footerText) {
    embed.setFooter({ text: payload.footerText });
  }

  await channel.send({ embeds: [embed] }).catch(() => {});
}

function formatBlacklistLogEmbedFromText(content) {
  const lines = String(content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const firstLine = lines[0] || 'Ticket Blacklist';
  const isRemove = /maknut/i.test(firstLine);
  const color = isRemove ? '#3ba55d' : '#ed4245';
  const title = isRemove
    ? 'Korisnik Maknut S Blackliste'
    : 'Korisnik Dodan Na Blacklistu';

  const details = {};
  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (value) details[key] = value;
  }

  const extractId = (value) => {
    const match = String(value || '').match(/\((\d{5,})\)/);
    return match ? match[1] : null;
  };

  const userId = extractId(details.korisnik);
  const actorId = extractId(details.dodao || details.maknuo);
  const actorLabel = isRemove ? 'Maknuo' : 'Dodao';
  const actionEmoji = isRemove ? 'ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦' : 'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â';

  const userDisplay = userId ? `<@${userId}>` : (details.korisnik || '-');
  const actorDisplay = actorId
    ? `<@${actorId}>`
    : (details.dodao || details.maknuo || '-');

  const fields = [
    {
      name: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ËœÃ‚Â¤ Korisnik',
      value: `${userDisplay}\n\`${userId || details.korisnik || '-'}\``,
      inline: true,
    },
    {
      name: `ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂºÃ‚Â¡ÃƒÂ¯Ã‚Â¸Ã‚Â ${actorLabel}`,
      value: `${actorDisplay}\n\`${actorId || details.dodao || details.maknuo || '-'}\``,
      inline: true,
    },
  ];

  if (details.razlog) {
    fields.push({
      name: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Razlog',
      value: details.razlog,
      inline: false,
    });
  } else if (!isRemove) {
    fields.push({
      name: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Razlog',
      value: '[prazno]',
      inline: false,
    });
  }

  return {
    color,
    title: `${actionEmoji} ${title}`,
    fields,
    footerText: `User ID: ${userId || '-'} ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ${new Date().toLocaleString('hr-HR')}`,
  };
}

async function addBlacklistRole(member) {
  if (!member || !BLACKLIST_ROLE_ID) return false;
  if (member.roles.cache.has(BLACKLIST_ROLE_ID)) return true;

  await member.roles.add(BLACKLIST_ROLE_ID).catch(() => {});
  return member.roles.cache.has(BLACKLIST_ROLE_ID);
}

async function removePlayerRole(member) {
  if (!member || !PLAYER_ROLE_ID) return false;
  if (!member.roles.cache.has(PLAYER_ROLE_ID)) return true;

  await member.roles.remove(PLAYER_ROLE_ID).catch(() => {});
  return !member.roles.cache.has(PLAYER_ROLE_ID);
}

async function addPlayerRole(member) {
  if (!member || !PLAYER_ROLE_ID) return false;
  if (member.roles.cache.has(PLAYER_ROLE_ID)) return true;

  await member.roles.add(PLAYER_ROLE_ID).catch(() => {});
  return member.roles.cache.has(PLAYER_ROLE_ID);
}

async function removeBlacklistRole(member) {
  if (!member || !BLACKLIST_ROLE_ID) return false;
  if (!member.roles.cache.has(BLACKLIST_ROLE_ID)) return true;

  await member.roles.remove(BLACKLIST_ROLE_ID).catch(() => {});
  return !member.roles.cache.has(BLACKLIST_ROLE_ID);
}

// mapa za FARMING zadatke (po korisniku)
const activeTasks = new Map(); // key: userId, value: { field: string | null }
const pendingTicketForms = new Map(); // key: userId, value: { type, questions, answers }

// === mapa za ticket REMINDER-e (kanal -> intervalId) ===
const ticketReminders = new Map();

// === mapa za AUTO-CLOSE tiketa (kanal -> timeoutId) ===
const ticketInactivity = new Map();

async function registerApplicationCommands() {
  if (!token || !clientId || !guildId) {
    console.log('Slash komande nisu registrirane: nedostaje TOKEN, CLIENT_ID ili GUILD_ID.');
    return;
  }

  try {
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    console.log('Slash komande su registrirane/azurirane.');
  } catch (err) {
    console.log('Registracija slash komandi nije uspjela:', err.message);
  }
}

console.log('ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â¶ PokreÃƒâ€žÃ¢â‚¬Â¡em bota...');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, // za messageCreate
  ],
});

client.once('ready', async () => {
  console.log(`ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Bot je online kao ${client.user.tag}`);

  // ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ AUTOMATSKO OBNAVLJANJE SEZONE SJETVE PRI STARTU BOTA
  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (guild) {
      await updateSeasonEmbed(guild);
      console.log("ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ Sezona Sjetve ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â embed obnovljen pri startu bota.");
    }
  } catch (err) {
    console.log("ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â GreÃƒâ€¦Ã‚Â¡ka pri obnavljanju Sezone Sjetve:", err);
  }
  await registerApplicationCommands();
});


client.on('error', (err) => {
  console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Client error:', err);
});

// === helperi za reminder ===
function stopTicketReminder(channelId) {
  const intervalId = ticketReminders.get(channelId);
  if (intervalId) {
    clearInterval(intervalId);
    ticketReminders.delete(channelId);
  }
}

function startTicketReminder(channel, userId) {
  stopTicketReminder(channel.id);

  const cfg = getTicketConfig();
  // reminderHours sada tretiramo kao MINUTE
  const intervalMs = (cfg.reminderHours || 3) * 60 * 1000;

  const intervalId = setInterval(async () => {
    try {
      const ch = await channel.client.channels.fetch(channel.id).catch(() => null);
      if (!ch || ch.deleted) {
        stopTicketReminder(channel.id);
        return;
      }

      if (ch.name.startsWith('closed-')) {
        stopTicketReminder(channel.id);
        return;
      }

      const text = (cfg.messages.reminder || DEFAULT_TICKET_SYSTEM.messages.reminder)
        .replace(/{user}/g, `<@${userId}>`);

      await ch.send({ content: text });
    } catch (err) {
      console.error('GreÃƒâ€¦Ã‚Â¡ka pri slanju ticket remindera:', err);
    }
  }, intervalMs);

  ticketReminders.set(channel.id, intervalId);
}

// === helperi za AUTO-CLOSE nakon X sati ===
function stopTicketInactivity(channelId) {
  const timeoutId = ticketInactivity.get(channelId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    ticketInactivity.delete(channelId);
  }
}

function startTicketInactivity(channel) {
  stopTicketInactivity(channel.id);

  const cfg = getTicketConfig();
  const timeoutMs = (cfg.autoCloseHours || 48) * 60 * 60 * 1000;

  const timeoutId = setTimeout(async () => {
    try {
      const ch = await channel.client.channels.fetch(channel.id).catch(() => null);
      if (!ch || ch.deleted) {
        stopTicketInactivity(channel.id);
        return;
      }

      // ako je veÃƒâ€žÃ¢â‚¬Â¡ ruÃƒâ€žÃ‚Âno zatvoren
      if (ch.name.startsWith('closed-')) {
        stopTicketInactivity(channel.id);
        return;
      }

      const guild = ch.guild;
      const topic = ch.topic || '';
      const match = topic.match(/Ticket owner:\s*(\d+)/i);
      const ticketOwnerId = match ? match[1] : null;

      const msgText =
        (cfg.messages.autoClose || DEFAULT_TICKET_SYSTEM.messages.autoClose);

      await ch.send(msgText).catch(() => {});

      // preimenuj
      if (!ch.name.startsWith('closed-')) {
        await ch.setName(`closed-${ch.name}`).catch(() => {});
      }

      // zakljuÃƒâ€žÃ‚Âaj permisije
      await ch.permissionOverwrites
        .edit(guild.roles.everyone, {
          SendMessages: false,
          AddReactions: false,
        })
        .catch(() => {});

      if (ticketOwnerId) {
        await ch.permissionOverwrites
          .edit(ticketOwnerId, {
            SendMessages: false,
            AddReactions: false,
          })
          .catch(() => {});
      }

      if (SUPPORT_ROLE_ID) {
        await ch.permissionOverwrites
          .edit(SUPPORT_ROLE_ID, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          })
          .catch(() => {});
      }

      await ch.permissionOverwrites
        .edit(ch.client.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        })
        .catch(() => {});

      // poÃƒâ€¦Ã‚Â¡alji transkript (bot kao "zatvorio")
      const transcriptText = await sendTicketTranscript(ch, ch.client.user);

      await upsertTicketRecord({
        guildId: guild.id,
        userId: ticketOwnerId || '',
        username: '',
        ticketType: (topic.match(/Type:\s*([^\s|]+)/i) || [])[1] || '',
        ticketTitle: ch.name,
        status: 'auto_closed',
        channelId: ch.id,
        channelName: ch.name,
        closedById: ch.client.user.id,
        closedByTag: ch.client.user.tag,
        closeReason: 'auto_close',
        transcriptText,
      }).catch((err) => {
        console.log('TICKET RECORD AUTO CLOSE ERROR:', err.message);
      });

      // ugasi i reminder ako postoji
      stopTicketReminder(ch.id);

      // obriÃƒâ€¦Ã‚Â¡i kanal nakon 10 sekundi
      setTimeout(() => {
        ch.delete().catch(() => {});
      }, 10_000);
    } catch (err) {
      console.error('GreÃƒâ€¦Ã‚Â¡ka u auto-close tiketa:', err);
    } finally {
      stopTicketInactivity(channel.id);
    }
  }, timeoutMs);

  ticketInactivity.set(channel.id, timeoutId);
}

function chunkText(text, size = 1024) {
  const value = String(text || '').trim();
  if (!value) return [];

  const chunks = [];
  for (let i = 0; i < value.length; i += size) {
    chunks.push(value.slice(i, i + size));
  }
  return chunks;
}

function ticketTypeRequiresAge(type) {
  return type === 'igranje';
}

function buildPomocTicketModal(typeCfg) {
  const questions = Array.isArray(typeCfg?.questions)
    ? typeCfg.questions.map((question) => String(question || '').trim()).filter(Boolean).slice(0, 4)
    : [];

  const modal = new ModalBuilder()
    .setCustomId('ticket_answers:pomoc')
    .setTitle(typeCfg?.title || 'Pomoć');

  const questionRows = questions.map((question, index) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(`question_${index}`)
        .setLabel(question.slice(0, 45))
        .setPlaceholder(question.slice(0, 100))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
    )
  );

  modal.addComponents(...questionRows);
  return modal;
}

function buildTicketCategoryRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_category')
    .setPlaceholder('Odaberi vrstu tiketa')
    .addOptions(
      {
        label: 'Igranje na serveru',
        description: 'Godine + svako pitanje zasebno u istom modalu.',
        value: 'igranje',
        emoji: '??',
      },
      {
        label: 'Žalba na igrače',
        description: 'Prijavi igrača koji krši pravila servera.',
        value: 'zalba',
        emoji: '⚠️',
      },
      {
        label: 'Edit modova',
        description: 'Ako trebaš pomoć ili savjet oko edita modova.',
        value: 'modovi',
        emoji: '🧩',
      }
    );

  menu.addOptions({
    label: 'Pomoć',
    description: 'Pitanje ili problem za admin tim.',
    value: 'pomoc',
    emoji: '🛠️',
  });

  return new ActionRowBuilder().addComponents(menu);
}

function buildTicketQuestionModal(type, typeCfg) {
  const questions = Array.isArray(typeCfg?.questions)
    ? typeCfg.questions.map((question) => String(question || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const requiresAge = ticketTypeRequiresAge(type);
  const modal = new ModalBuilder()
    .setCustomId(`ticket_answers:${type}`)
    .setTitle(typeCfg?.title || 'Ticket');

  const ageRow = new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('age')
      .setLabel('Koliko imaš godina?')
      .setPlaceholder('Upiši svoje godine.')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(3)
  );

  const questionRows = questions.map((question, index) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(`question_${index}`)
        .setLabel(question.slice(0, 45))
        .setPlaceholder(question.slice(0, 100))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
    )
  );

  modal.addComponents(ageRow, ...questionRows);
  return modal;
}

async function saveTicketSubmission({
  guildId,
  userId,
  username,
  ticketType,
  status,
  age,
  isAdult,
  channelId,
  questions,
  answersText,
}) {
  if (!useMySql || !dbPool) {
    const data = loadDb();
    const submissions = Array.isArray(data.ticketSubmissions) ? data.ticketSubmissions : [];

    submissions.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      guildId: guildId || '',
      userId: userId || '',
      username: username || '',
      ticketType: ticketType || '',
      status: status || 'submitted',
      age: Number.isFinite(age) ? age : null,
      isAdult: Boolean(isAdult),
      channelId: channelId || null,
      questions: Array.isArray(questions) ? questions : [],
      answersText: String(answersText || ''),
      createdAt: new Date().toISOString(),
    });

    data.ticketSubmissions = submissions;
    saveDb(data);
    return;
  }

  await dbPool.query(
    `INSERT INTO ticket_submissions
      (guild_id, user_id, username, ticket_type, status, age, is_adult, channel_id, questions_json, answers_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      guildId || '',
      userId || '',
      username || '',
      ticketType || '',
      status || 'submitted',
      Number.isFinite(age) ? age : null,
      isAdult ? 1 : 0,
      channelId || null,
      JSON.stringify(Array.isArray(questions) ? questions : []),
      String(answersText || ''),
    ]
  );
}

async function upsertTicketRecord({
  guildId,
  userId,
  username,
  ticketType,
  ticketTitle,
  status,
  age = null,
  isAdult = null,
  channelId,
  channelName,
  claimedById = null,
  claimedByTag = null,
  closedById = null,
  closedByTag = null,
  closeReason = null,
  questions = null,
  answers = null,
  answersText = null,
  transcriptText = null,
}) {
  if (!channelId) return;

  if (!useMySql || !dbPool) {
    const data = loadDb();
    const records = Array.isArray(data.ticketRecords) ? data.ticketRecords : [];
    const existingIndex = records.findIndex((record) => record.channelId === channelId);
    const previous = existingIndex >= 0 ? records[existingIndex] : null;

    const nextRecord = {
      id: previous?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      guildId: guildId || previous?.guildId || '',
      userId: userId || previous?.userId || '',
      username: username || previous?.username || '',
      ticketType: ticketType || previous?.ticketType || '',
      ticketTitle: ticketTitle || previous?.ticketTitle || '',
      status: status || previous?.status || 'opened',
      age: Number.isFinite(age) ? age : previous?.age ?? null,
      isAdult:
        Number.isFinite(age) || typeof isAdult === 'boolean'
          ? Boolean(isAdult)
          : previous?.isAdult ?? false,
      channelId,
      channelName: channelName || previous?.channelName || '',
      claimedById: claimedById ?? previous?.claimedById ?? null,
      claimedByTag: claimedByTag ?? previous?.claimedByTag ?? null,
      closedById: closedById ?? previous?.closedById ?? null,
      closedByTag: closedByTag ?? previous?.closedByTag ?? null,
      closeReason: closeReason ?? previous?.closeReason ?? null,
      questions: Array.isArray(questions) ? questions : previous?.questions ?? [],
      answers: Array.isArray(answers) ? answers : previous?.answers ?? [],
      answersText:
        answersText == null || answersText === ''
          ? previous?.answersText ?? ''
          : String(answersText),
      transcriptText: transcriptText ?? previous?.transcriptText ?? null,
      openedAt: previous?.openedAt || new Date().toISOString(),
      claimedAt:
        claimedById && !previous?.claimedAt
          ? new Date().toISOString()
          : previous?.claimedAt ?? null,
      closedAt:
        (closedById || closeReason) && !previous?.closedAt
          ? new Date().toISOString()
          : previous?.closedAt ?? null,
      updatedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      records[existingIndex] = nextRecord;
    } else {
      records.push(nextRecord);
    }

    data.ticketRecords = records;
    saveDb(data);
    return;
  }

  await dbPool.query(
    `INSERT INTO ticket_records
      (guild_id, user_id, username, ticket_type, ticket_title, status, age, is_adult, channel_id, channel_name,
       claimed_by_id, claimed_by_tag, closed_by_id, closed_by_tag, close_reason, questions_json, answers_json, answers_text, transcript_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       guild_id = COALESCE(NULLIF(VALUES(guild_id), ''), guild_id),
       user_id = COALESCE(NULLIF(VALUES(user_id), ''), user_id),
       username = COALESCE(NULLIF(VALUES(username), ''), username),
       ticket_type = COALESCE(NULLIF(VALUES(ticket_type), ''), ticket_type),
       ticket_title = COALESCE(NULLIF(VALUES(ticket_title), ''), ticket_title),
       status = VALUES(status),
       age = COALESCE(VALUES(age), age),
       is_adult = CASE
         WHEN VALUES(age) IS NOT NULL THEN VALUES(is_adult)
         ELSE is_adult
       END,
       channel_name = VALUES(channel_name),
       claimed_by_id = COALESCE(VALUES(claimed_by_id), claimed_by_id),
       claimed_by_tag = COALESCE(VALUES(claimed_by_tag), claimed_by_tag),
       closed_by_id = COALESCE(VALUES(closed_by_id), closed_by_id),
       closed_by_tag = COALESCE(VALUES(closed_by_tag), closed_by_tag),
       close_reason = COALESCE(VALUES(close_reason), close_reason),
       questions_json = COALESCE(NULLIF(VALUES(questions_json), 'null'), questions_json),
       answers_json = COALESCE(NULLIF(VALUES(answers_json), 'null'), answers_json),
       answers_text = COALESCE(NULLIF(VALUES(answers_text), ''), answers_text),
       transcript_text = COALESCE(VALUES(transcript_text), transcript_text),
       claimed_at = CASE
         WHEN VALUES(claimed_by_id) IS NOT NULL AND claimed_at IS NULL THEN CURRENT_TIMESTAMP
         ELSE claimed_at
       END,
       closed_at = CASE
         WHEN VALUES(closed_by_id) IS NOT NULL OR VALUES(close_reason) IS NOT NULL THEN CURRENT_TIMESTAMP
         ELSE closed_at
       END`,
    [
      guildId || '',
      userId || '',
      username || '',
      ticketType || '',
      ticketTitle || '',
      status || 'opened',
      Number.isFinite(age) ? age : null,
      isAdult ? 1 : 0,
      channelId,
      channelName || '',
      claimedById,
      claimedByTag,
      closedById,
      closedByTag,
      closeReason,
      questions == null ? 'null' : JSON.stringify(Array.isArray(questions) ? questions : []),
      answers == null ? 'null' : JSON.stringify(Array.isArray(answers) ? answers : []),
      answersText == null ? '' : String(answersText),
      transcriptText,
    ]
  );
}

async function sendIgranjeWelcomeEmbeds(channel) {
  if (!channel) return;

  const cfg = getTicketConfig();
  const launcherChannelId = cfg.launcherChannelId || DEFAULT_TICKET_SYSTEM.launcherChannelId;
  const launcherChannelMention = launcherChannelId ? `<#${launcherChannelId}>` : '#launcher';
  const footerIcon =
    channel.guild.iconURL?.({ extension: 'png', size: 128 }) || null;
  const footerText = channel.guild.name || 'Slavonska Ravnica';
  const replacePlaceholders = (text) =>
    String(text || '')
      .replace(/\{launcherChannel\}/g, launcherChannelMention)
      .replace(/\{guildName\}/g, channel.guild.name || 'Slavonska Ravnica');

  const welcomeEmbed = new EmbedBuilder()
    .setColor('#39d353')
    .setTitle(cfg.messages?.igranjeWelcomeTitle || DEFAULT_TICKET_SYSTEM.messages.igranjeWelcomeTitle)
    .setDescription(replacePlaceholders(cfg.messages?.igranjeWelcomeBody || DEFAULT_TICKET_SYSTEM.messages.igranjeWelcomeBody))
    .setFooter(footerIcon ? { text: footerText, iconURL: footerIcon } : { text: footerText })
    .setTimestamp();

  const rulesEmbed = new EmbedBuilder()
    .setColor('#ff5c5c')
    .setTitle(cfg.messages?.igranjeRulesTitle || DEFAULT_TICKET_SYSTEM.messages.igranjeRulesTitle)
    .setDescription(replacePlaceholders(cfg.messages?.igranjeRulesBody || DEFAULT_TICKET_SYSTEM.messages.igranjeRulesBody))
    .setFooter(footerIcon ? { text: footerText, iconURL: footerIcon } : { text: footerText })
    .setTimestamp();

  const launcherEmbed = new EmbedBuilder()
    .setColor('#4f86ff')
    .setTitle(cfg.messages?.igranjeLauncherTitle || DEFAULT_TICKET_SYSTEM.messages.igranjeLauncherTitle)
    .setDescription(replacePlaceholders(cfg.messages?.igranjeLauncherBody || DEFAULT_TICKET_SYSTEM.messages.igranjeLauncherBody))
    .setFooter(footerIcon ? { text: footerText, iconURL: footerIcon } : { text: footerText })
    .setTimestamp();

  await channel.send({ embeds: [welcomeEmbed] });
  await channel.send({ embeds: [rulesEmbed] });
  await channel.send({ embeds: [launcherEmbed] });
}

async function openTicketChannelFromModalAnswers({
  guild,
  member,
  type,
  cfg,
  typeCfg,
  answers,
  age = null,
  questions = [],
  answersText = '',
}) {
  const channelName = `ticket-${type}-${member.user.username}`.toLowerCase();

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: cfg.categoryId || TICKET_CATEGORY_ID,
    topic: `Ticket owner: ${member.id} | Type: ${type}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: cfg.supportRoleId || SUPPORT_ROLE_ID,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  const introEmbed = new EmbedBuilder()
    .setColor('#ffd000')
    .setTitle(typeCfg?.title || 'Ticket')
    .setDescription(
      [
        `Otvorio: <@${member.id}>`,
        `Tip: **${typeCfg?.title || type}**`,
        '',
        'Korisnik je popunio upitnik preko modala. Odgovori su ispod.',
      ].join('\n')
    )
    .setTimestamp();

  const answerFields = [];
  for (const [index, entry] of (Array.isArray(answers) ? answers : []).entries()) {
    const chunks = chunkText(entry.answer || '-', 1024);
    if (!chunks.length) {
      answerFields.push({
        name: `${index + 1}. ${entry.question}`.slice(0, 256),
        value: '-',
      });
      continue;
    }

    chunks.forEach((chunk, chunkIndex) => {
      answerFields.push({
        name:
          chunkIndex === 0
            ? `${index + 1}. ${entry.question}`.slice(0, 256)
            : `Nastavak ${index + 1}`.slice(0, 256),
        value: chunk,
      });
    });
  }

  if (answerFields.length) {
    introEmbed.addFields(answerFields);
  } else {
    introEmbed.addFields({
      name: 'Opis',
      value: 'Ticket je otvoren bez dodatnih pitanja iz modala.',
    });
  }

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel('Preuzmi tiket')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Zatvori tiket')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@${member.id}>`,
    embeds: [introEmbed],
    components: [buttons],
  });

  if (type === 'igranje') {
    await sendIgranjeWelcomeEmbeds(channel).catch((err) => {
      console.log('IGRANJE WELCOME EMBEDS ERROR:', err.message);
    });
  }

  await upsertTicketRecord({
    guildId: guild.id,
    userId: member.id,
    username: member.user.tag,
    ticketType: type,
    ticketTitle: typeCfg?.title || type,
    status: 'opened',
    age,
    isAdult: Number.isFinite(age) ? age >= 18 : false,
    channelId: channel.id,
    channelName: channel.name,
    questions,
    answers,
    answersText,
  }).catch((err) => {
    console.log('TICKET RECORD SAVE ERROR:', err.message);
  });

  startTicketInactivity(channel);
  return channel;
}

// === helper za transkript tiketa ===
async function sendTicketTranscript(channel, closedByUser) {
  try {
    let allMessages = [];
    let lastId;

    while (true) {
      const fetched = await channel.messages.fetch({
        limit: 100,
        before: lastId,
      });

      if (fetched.size === 0) break;

      allMessages.push(...Array.from(fetched.values()));
      lastId = fetched.last().id;

      if (allMessages.length >= 1000) break;
    }

    allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const lines = allMessages.map((msg) => {
      const time = new Date(msg.createdTimestamp).toLocaleString('hr-HR');
      const author = `${msg.author.tag} (${msg.author.id})`;
      const content = msg.content || '';
      return `[${time}] ${author}: ${content}`;
    });

    const transcriptText =
      lines.join('\n') || 'Nema poruka u ovom tiketu.';

    const buffer = Buffer.from(transcriptText, 'utf-8');
    const cfg = getTicketConfig();
    const logId = cfg.logChannelId;

    if (logId) {
      const logChannel = await channel.client.channels
        .fetch(logId)
        .catch(() => null);

      if (logChannel) {
        await logChannel.send({
          content: `Transkript zatvorenog tiketa: ${channel.name}\nZatvorio: ${closedByUser.tag}`,
          files: [{ attachment: buffer, name: `transkript-${channel.id}.txt` }],
        });
      }
    }

    return transcriptText;
  } catch (err) {
    console.error('Greska pri slanju transkripta:', err);
    return null;
  }
}

// ============== WELCOME + LOGGING ==============
client.on('guildMemberAdd', async (member) => {
  const data = loadDb();
  const cfg = data.welcome;
  const blacklistEntry = await getTicketBlacklistEntry(member.guild.id, member.id);

  if (blacklistEntry) {
    await addBlacklistRole(member);
    await removePlayerRole(member);
  }

  if (cfg?.channelId && cfg?.message) {
    const ch = await client.channels.fetch(cfg.channelId).catch(() => null);
    if (ch) {
      const msg = cfg.message
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{username}/g, member.user.username);

      ch.send(msg).catch(() => {});
    }
  }

  if (data.logging?.channelId) {
    const logCh = await client.channels
      .fetch(data.logging.channelId)
      .catch(() => null);
    if (logCh) {
      if (blacklistEntry) {
        logCh
          .send(
            `ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â Blacklist korisnik se vratio: ${member.user.tag} (ID: ${member.id})` +
              (blacklistEntry.reason ? ` | Razlog: ${blacklistEntry.reason}` : '')
          )
          .catch(() => {});
        return;
      }
      logCh
        .send(`ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Novi Ãƒâ€žÃ‚Âlan: ${member.user.tag} (ID: ${member.id})`)
        .catch(() => {});
    }
  }
});

// ============== MESSAGE CREATE (tiketi: reminder + inactivity) ==============
client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const channel = message.channel;

  // ako je ovo tiket koji pratimo za inactivity ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ reset Xh timera
  if (ticketInactivity.has(channel.id)) {
    startTicketInactivity(channel);
  }

  // ako nema reminder za ovaj kanal, dalje nas niÃƒâ€¦Ã‚Â¡ta ne zanima
  if (!ticketReminders.has(channel.id)) return;

  const topic = channel.topic || '';
  const match = topic.match(/Ticket owner:\s*(\d+)/i);
  const ticketOwnerId = match ? match[1] : null;

  if (!ticketOwnerId) return;
  if (message.author.id !== ticketOwnerId) return;

  // vlasnik tiketa je odgovorio ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ zaustavi reminder
  stopTicketReminder(channel.id);
});

// ============== SLASH KOMANDE + INTERAKCIJE ==============
client.on('interactionCreate', async (interaction) => {
  // ---------- SLASH KOMANDE ----------
  if (interaction.isChatInputCommand()) {
    // /ticket-panel
    if (interaction.commandName === 'ticket-panel') {
      const embed = new EmbedBuilder()
        .setColor('#ffd000')
        .setTitle('Ticket sustav')
        .setDescription(
          'Molimo vas da pažljivo pročitate ovu poruku prije nego što otvorite tiket.\n\n' +
            '**Opcije:**\n' +
            '• **Igranje na serveru:** Zahtjev za pridruživanje serveru.\n' +
            '• **Žalba na igrače:** Prijava igrača koji krši pravila servera.\n' +
            '• **Edit modova:** Pomoć, ideje ili problemi vezani uz edit modova.\n' +
            '• **Pomoć:** Pitanja ili problemi za admin tim.\n\n' +
            'Prije otvaranja tiketa\n' +
            '1. Provjerite jeste li sve instalirali i podesili prema uputama.\n' +
            '2. Pokušajte sami riješiti problem i provjerite da nije do vaših modova ili klijenta.\n' +
            '3. Ako ne uspijete, otvorite tiket i detaljno opišite svoj problem.\n' +
            '4. Budite strpljivi, netko iz tima će vam se javiti čim bude moguće.\n\n' +
            'Pravila tiketa:\n' +
            '• Svi problemi moraju biti jasno i detaljno opisani, bez poruka tipa "ne radi".\n' +
            '• Poštujte članove staff tima.\n' +
            '• Ne pingajte staff bez razloga, netko će vam se javiti.\n' +
            '• Tiket bez odgovora korisnika 48h bit će zatvoren.\n' +
            '• Ne otvarajte tikete u pogrešnoj kategoriji.\n' +
            '• Kršenje pravila može rezultirati zatvaranjem tiketa ili sankcijama.'
        );

      const row = buildTicketCategoryRow();

      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();

      const channel = interaction.channel;
      await channel.send({ embeds: [embed], components: [row] });
    }

    // /task-panel ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ Farming zadaci
if (interaction.commandName === 'task-panel') {
  const embed = new EmbedBuilder()
    .setColor('#ffd900')
    .setTitle('ÃƒÂ°Ã…Â¸Ã…Â¡Ã…â€œ Farming ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ Zadaci')
    .setDescription('Odaberi Ãƒâ€¦Ã‚Â¡to Ãƒâ€¦Ã‚Â¾eliÃƒâ€¦Ã‚Â¡ kreirati.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('task_start')
      .setLabel('ÃƒÂ¢Ã…Â¾Ã¢â‚¬Â¢ Kreiraj posao (polja)')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId('task_general_start')
      .setLabel('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Kreiraj zadatak')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.deferReply({ ephemeral: true });
  await interaction.deleteReply();

  await interaction.channel.send({
    embeds: [embed],
    components: [row],
  });
}


    // /add-field value:<string>
    if (interaction.commandName === 'add-field') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â Samo staff/admin moÃƒâ€¦Ã‚Â¾e dodavati nova polja.',
          ephemeral: true,
        });
      }

      const value = interaction.options.getString('value', true).trim();

      if (!value) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â MoraÃƒâ€¦Ã‚Â¡ upisati oznaku polja (npr. `56-276`).',
          ephemeral: true,
        });
      }

      const fields = getFarmingFields();
      if (fields.includes(value)) {
        return interaction.reply({
          content: `ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Polje **${value}** veÃƒâ€žÃ¢â‚¬Â¡ postoji u listi.`,
          ephemeral: true,
        });
      }

      fields.push(value);
      saveFarmingFields(fields);

      return interaction.reply({
        content: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Polje **${value}** je dodano u listu. Dostupno je u task-panelu.`,
        ephemeral: true,
      });
    }

    // /remove-field value:<string>
    if (interaction.commandName === 'remove-field') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â Samo staff/admin moÃƒâ€¦Ã‚Â¾e brisati polja.',
          ephemeral: true,
        });
      }

      const value = interaction.options.getString('value', true).trim();
      const fields = getFarmingFields();
      const index = fields.indexOf(value);

      if (index === -1) {
        return interaction.reply({
          content: `ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Polje **${value}** nije pronaÃƒâ€žÃ¢â‚¬Ëœeno u listi.`,
          ephemeral: true,
        });
      }

      fields.splice(index, 1);
      saveFarmingFields(fields);

      return interaction.reply({
        content: `ÃƒÂ°Ã…Â¸Ã¢â‚¬â€Ã¢â‚¬ËœÃƒÂ¯Ã‚Â¸Ã‚Â Polje **${value}** je uklonjeno iz liste.`,
        ephemeral: true,
      });
    }

    // /list-fields
    if (interaction.commandName === 'list-fields') {
      const fields = getFarmingFields();

      if (!fields.length) {
        return interaction.reply({
          content: 'Lista polja je trenutno prazna.',
          ephemeral: true,
        });
      }

      return interaction.reply({
        content:
          'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Â¹ Trenutna polja za Farming zadatke:\n' +
          fields.map((f) => `ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ${f}`).join('\n'),
        ephemeral: true,
      });
    }

    // /field-panel ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ poruka s gumbom za dodavanje polja
    if (interaction.commandName === 'field-panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â Samo staff/admin moÃƒâ€¦Ã‚Â¾e postaviti ovaj panel.',
          ephemeral: true,
        });
      }
      

      const embed = new EmbedBuilder()
        .setColor('#3ba55d')
        .setTitle('ÃƒÂ°Ã…Â¸Ã‚Â§Ã¢â‚¬ËœÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ Upravljanje poljima')
        .setDescription(
          'Ovdje moÃƒâ€¦Ã‚Â¾eÃƒâ€¦Ã‚Â¡ dodati nova polja za Farming zadatke.\n\n' +
          'Klikni na gumb ispod, unesi oznaku polja (npr. `56-276`) i bot Ãƒâ€žÃ¢â‚¬Â¡e ga spremiti.\n' +
          'Ta polja se automatski koriste u **task-panel** sistemu.'
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('field_add_button')
          .setLabel('ÃƒÂ¢Ã…Â¾Ã¢â‚¬Â¢ Dodaj novo polje')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.reply({ embeds: [embed], components: [row] });
    }

    // /reset-season ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ resetira aktivnu sezonu sjetve
    if (interaction.commandName === 'blacklist') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: 'ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Samo staff/admin moÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾e dodavati korisnike na ticket blacklistu.',
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || '';

      const entry = await addUserToTicketBlacklist({
        guildId: interaction.guild?.id,
        userId: targetUser.id,
        addedBy: interaction.user.id,
        reason,
      });
      const targetMember = await interaction.guild.members
        .fetch(targetUser.id)
        .catch(() => null);

      if (targetMember) {
        await addBlacklistRole(targetMember);
        await removePlayerRole(targetMember);
      }

      await sendBlacklistLog(
        interaction.guild,
        [
          'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â Korisnik dodan na ticket blacklistu',
          `Korisnik: ${targetUser.tag} (${targetUser.id})`,
          `Dodao: ${interaction.user.tag} (${interaction.user.id})`,
          entry.reason ? `Razlog: ${entry.reason}` : null,
        ].filter(Boolean).join('\n')
      );

      return interaction.reply({
        content:
          `ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â <@${targetUser.id}> je dodan na ticket blacklistu i vise ne moze otvarati tickete.` +
          (entry.reason ? `\nRazlog: ${entry.reason}` : ''),
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'unblacklist') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: 'ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Samo staff/admin moÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾e skidati korisnike s ticket blackliste.',
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser('user', true);
      const removed = await removeUserFromTicketBlacklist(
        interaction.guild?.id,
        targetUser.id
      );
      const targetMember = await interaction.guild.members
        .fetch(targetUser.id)
        .catch(() => null);

      if (removed && targetMember) {
        await removeBlacklistRole(targetMember);
        await addPlayerRole(targetMember);
      }

      if (removed) {
        await sendBlacklistLog(
          interaction.guild,
          [
            'ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Korisnik maknut s ticket blackliste',
            `Korisnik: ${targetUser.tag} (${targetUser.id})`,
            `Maknuo: ${interaction.user.tag} (${interaction.user.id})`,
          ].join('\n')
        );
      }

      return interaction.reply({
        content: removed
          ? `ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ <@${targetUser.id}> je maknut s ticket blackliste i ponovno moze otvarati tickete.`
          : `ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â <@${targetUser.id}> nije bio na ticket blackliste.`,
        ephemeral: true,
      });
    }

if (interaction.commandName === 'reset-season') {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: 'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â NemaÃƒâ€¦Ã‚Â¡ permisije za reset sezone.',
      ephemeral: true,
    });
  }


  const seasons = getSowingSeasons();
  const active = getActiveSeason();

  // 1ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÂ¢Ã†â€™Ã‚Â£ Resetiramo polja
  active.fields = {};
  active.completed = false;

  // 2ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÂ¢Ã†â€™Ã‚Â£ ZapiÃƒâ€¦Ã‚Â¡emo nazad u DB
  const index = seasons.findIndex(s => s.season === active.season);
  seasons[index] = active;
  saveSowingSeasons(seasons);

  // 3ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÂ¢Ã†â€™Ã‚Â£ OÃƒâ€žÃ‚Âistimo embed totalno
  await updateSeasonEmbed(interaction.guild, true);

  return interaction.reply({
    content: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ Sezona resetirana! Ãƒâ€¦Ã‚Â½ivi embed je oÃƒâ€žÃ‚ÂiÃƒâ€¦Ã‚Â¡Ãƒâ€žÃ¢â‚¬Â¡en.',
    ephemeral: true,
  });
}

// /update-field
if (interaction.commandName === 'update-field') {
  // samo staff
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: 'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â Samo staff moÃƒâ€¦Ã‚Â¾e ureÃƒâ€žÃ¢â‚¬Ëœivati polja.',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('update_field_step1')
    .setTitle('Uredi polje ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ Korak 1');

  const input = new TextInputBuilder()
    .setCustomId('old_field')
    .setLabel('Koje polje Ãƒâ€¦Ã‚Â¾eliÃƒâ€¦Ã‚Â¡ editovati? (npr. 5)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(input);
  modal.addComponents(row);

  return interaction.showModal(modal);

}


 }

  // ---------- KREIRANJE TIKETA (dropdown) ----------
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === 'ticket_category'
  ) {
    const type = interaction.values[0];
    const guild = interaction.guild;
    const member = interaction.member;
    const blacklistEntry = await getTicketBlacklistEntry(
      interaction.guild?.id,
      interaction.user.id
    );

    if (blacklistEntry) {
      return interaction.reply({
        content:
          '⛔ Trenutno ne možeš otvoriti ticket jer si na ticket blackliste.' +
          (blacklistEntry.reason ? `\nRazlog: ${blacklistEntry.reason}` : ''),
        ephemeral: true,
      });
    }

    const cfg = getTicketConfig();
    const typeCfg = cfg.types[type];

    if (!typeCfg) {
      return interaction.reply({
        content: '⚠️ Odabrani ticket tip nije pronađen. Pokušaj ponovno.',
        ephemeral: true,
      });
    }

    pendingTicketForms.set(interaction.user.id, {
      type,
      questions: Array.isArray(typeCfg.questions) ? typeCfg.questions : [],
    });

    if (interaction.message?.editable) {
      await interaction.message.edit({
        components: [buildTicketCategoryRow()],
      }).catch(() => {});
    }

    if (type === 'pomoc') {
      await interaction.showModal(buildPomocTicketModal(typeCfg));
      return;
    }

    await interaction.showModal(buildTicketQuestionModal(type, typeCfg));
    return;

    const channelName = `ticket-${type}-${member.user.username}`.toLowerCase();

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: cfg.categoryId || TICKET_CATEGORY_ID,
      topic: `Ticket owner: ${member.id} | Type: ${type}`,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: cfg.supportRoleId || SUPPORT_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });

    let ticketMessage = '';

    switch (type) {
      case 'igranje':
        if (typeCfg && typeCfg.questions?.length) {
          ticketMessage = [
            `ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â® Pozdrav <@${member.id}>, hvala ?to si otvorio **${typeCfg.title || 'Igranje na serveru'}** ticket.`,
            '',
            '# ÃƒÂ°Ã…Â¸Ã‚Â§Ã‚Â¾ Evo da skratimo stvari i ubrzamo proces',
            '',
            '**Odgovori na sljede?a pitanja:**',
            '',
            ...typeCfg.questions.map((q) => `- ${q}`),
            '',
            'ÃƒÂ°Ã…Â¸Ã¢â‚¬Â¢Ã‚Â¹ÃƒÂ¯Ã‚Â¸Ã‚Â Kada odgovoriÃƒâ€¦Ã‚Â¡ na ova pitanja, neko iz tima Ãƒâ€žÃ¢â‚¬Â¡e ti se ubrzo javiti.',
          ].join('\n');
        } else {
          ticketMessage = [
            `ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â® Pozdrav <@${member.id}>, hvala ?to si otvorio **Igranje na serveru** ticket.`,
            '',
            '# ÃƒÂ°Ã…Â¸Ã‚Â§Ã‚Â¾ Evo da skratimo stvari i ubrzamo proces',
            '',
            '**ImaÃƒâ€¦Ã‚Â¡ par pitanja pa Ãƒâ€žÃ‚Âisto da vlasnik ne gubi vrijeme kad preuzme ovaj tiket.**',
            '',
            '- Koliko Ãƒâ€žÃ‚Âesto planiraÃƒâ€¦Ã‚Â¡ da igraÃƒâ€¦Ã‚Â¡ na serveru? (npr. svakodnevno, par puta nedeljno...)',
            '- U koje vrijeme si najÃƒâ€žÃ‚ÂeÃƒâ€¦Ã‚Â¡Ãƒâ€žÃ¢â‚¬Â¡e aktivan? (npr. popodne, uveÃƒâ€žÃ‚Âe, vikendom...)',
            '- Da li si spreman da poÃƒâ€¦Ã‚Â¡tujeÃƒâ€¦Ã‚Â¡ raspored i obaveze na farmi (npr. oranje, Ãƒâ€¦Ã‚Â¾etva, hranjenje stoke)?',
            '- Kako bi reagovao ako neko iz tima ne poÃƒâ€¦Ã‚Â¡tuje dogovor ili pravila igre?',
            '- Da li koristiÃƒâ€¦Ã‚Â¡ voice chat (Discord) tokom igre?',
            '- Da li si spreman da pomogneÃƒâ€¦Ã‚Â¡ drugim igraÃƒâ€žÃ‚Âima (npr. novim Ãƒâ€žÃ‚Âlanovima tima)?',
            '- ZaÃƒâ€¦Ã‚Â¡to Ãƒâ€¦Ã‚Â¾eliÃƒâ€¦Ã‚Â¡ da igraÃƒâ€¦Ã‚Â¡ baÃƒâ€¦Ã‚Â¡ na hard serveru?',
            '',
            'ÃƒÂ°Ã…Â¸Ã¢â‚¬Â¢Ã‚Â¹ÃƒÂ¯Ã‚Â¸Ã‚Â Kada odgovoriÃƒâ€¦Ã‚Â¡ na ova pitanja, neko iz tima Ãƒâ€žÃ¢â‚¬Â¡e ti se ubrzo javiti.',
          ].join('\n');
        }
        break;

      case 'zalba':
        if (typeCfg && typeCfg.questions?.length) {
          ticketMessage = [
            `ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Pozdrav <@${member.id}>, hvala ?to si otvorio **${typeCfg.title || 'Ãƒâ€¦Ã‚Â¾albu na igraÃƒâ€žÃ‚Âe'}** ticket.`,
            '',
            '**Molimo te da odgovoriÃƒâ€¦Ã‚Â¡ na sljede?a pitanja:**',
            '',
            ...typeCfg.questions.map((q) => `- ${q}`),
            '',
            'ÃƒÂ°Ã…Â¸Ã¢â‚¬ËœÃ‚Â® Moderatori Ãƒâ€žÃ¢â‚¬Â¡e pregledati prijavu i javiti ti se.',
          ].join('\n');
        } else {
          ticketMessage =
            `ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Pozdrav <@${member.id}>, hvala ?to si otvorio **Ãƒâ€¦Ã‚Â¾albu na igraÃƒâ€žÃ‚Âe**.\n` +
            'Molimo te da navedeÃƒâ€¦Ã‚Â¡:\n' +
            'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Ime igraÃƒâ€žÃ‚Âa na kojeg se Ãƒâ€¦Ã‚Â¾aliÃƒâ€¦Ã‚Â¡\n' +
            'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Vrijeme i detaljan opis situacije\n' +
            'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Dokaze (slike, video, logovi) ako ih imaÃƒâ€¦Ã‚Â¡.\n' +
            'ÃƒÂ°Ã…Â¸Ã¢â‚¬ËœÃ‚Â® Moderatori Ãƒâ€žÃ¢â‚¬Â¡e pregledati prijavu i javiti ti se.';
        }
        break;

      case 'modovi':
        if (typeCfg && typeCfg.questions?.length) {
          ticketMessage = [
            `ÃƒÂ°Ã…Â¸Ã‚Â§Ã‚Â© Pozdrav <@${member.id}>, hvala ?to si otvorio **${typeCfg.title || 'izrada modova'}** ticket.`,
            '',
            '**Kako bismo ti lakÃƒâ€¦Ã‚Â¡e pomogli, odgovori na sljede?a pitanja:**',
            '',
            ...typeCfg.questions.map((q) => `- ${q}`),
            '',
            'ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¡ Ãƒâ€¦Ã‚Â to viÃƒâ€¦Ã‚Â¡e informacija daÃƒâ€¦Ã‚Â¡, lakÃƒâ€¦Ã‚Â¡e Ãƒâ€žÃ¢â‚¬Â¡emo pomoÃƒâ€žÃ¢â‚¬Â¡i.',
          ].join('\n');
        } else {
          ticketMessage =
            `ÃƒÂ°Ã…Â¸Ã‚Â§Ã‚Â© Pozdrav <@${member.id}>, hvala ?to si otvorio **izrada modova** ticket.\n` +
            'OpiÃƒâ€¦Ã‚Â¡i kakav mod radiÃƒâ€¦Ã‚Â¡ ili s kojim dijelom imaÃƒâ€¦Ã‚Â¡ problem.\n' +
            'ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¡ Slobodno poÃƒâ€¦Ã‚Â¡alji kod, ideju ili primjer ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ Ãƒâ€¦Ã‚Â¡to viÃƒâ€¦Ã‚Â¡e informacija daÃƒâ€¦Ã‚Â¡, lakÃƒâ€¦Ã‚Â¡e Ãƒâ€žÃ¢â‚¬Â¡emo pomoÃƒâ€žÃ¢â‚¬Â¡i.';
        }
        break;

      default:
        ticketMessage =
          `ÃƒÂ°Ã…Â¸Ã¢â‚¬ËœÃ¢â‚¬Â¹ Pozdrav <@${member.id}>, hvala ?to si otvorio ticket.\n` +
          'Molimo te da opiÃƒâ€¦Ã‚Â¡eÃƒâ€¦Ã‚Â¡ svoj problem Ãƒâ€¦Ã‚Â¡to detaljnije.';
        break;
    }

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('Preuzmi tiket')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Zatvori tiket')
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: ticketMessage,
      components: [buttons],
    });

    // pokreni automatski podsjetnik
    startTicketReminder(channel, member.id);
    // pokreni i inactivity auto-close
    startTicketInactivity(channel);

    await interaction.reply({
      content: `Tvoj ticket je otvoren: ${channel}`,
      ephemeral: true,
    });
  }

  // ---------- BUTTONI (TICKETI + FARMING) ----------
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('ticket_modal_continue:')) {
      const [, type, stepRaw] = interaction.customId.split(':');
      const cfg = getTicketConfig();
      const typeCfg = cfg.types[type];
      const stepIndex = Number(stepRaw || 0);

      if (!typeCfg) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ticket forma nije pronaÃƒâ€žÃ¢â‚¬Ëœena. PokuÃƒâ€¦Ã‚Â¡aj ponovno.',
          ephemeral: true,
        });
      }

      return interaction.showModal(buildTicketQuestionModal(type, typeCfg, stepIndex));
    }

    // === FARMING: dugme za dodavanje polja (iz field-panel poruke) ===
    if (interaction.customId === 'field_add_button') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â Samo staff/admin moÃƒâ€¦Ã‚Â¾e dodavati polja.',
          ephemeral: true,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('field_add_modal')
        .setTitle('Dodavanje novog polja');

      const input = new TextInputBuilder()
        .setCustomId('field_value')
        .setLabel('Oznaka polja (npr. 56-276)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    // === FARMING: START KREIRANJA POSLA === 
if (interaction.customId === 'task_start') {
  activeTasks.set(interaction.user.id, { field: null });

  const FIELDS = getFarmingFields();
  const perRow = 5;
  const rows = [];

  for (let i = 0; i < FIELDS.length; i += perRow) {
    const row = new ActionRowBuilder();
    const slice = FIELDS.slice(i, i + perRow);

    for (const field of slice) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`task_field_${field}`)
          .setLabel(`Polje ${field}`)
          .setStyle(ButtonStyle.Secondary)
      );
    }

    rows.push(row);
  }

  const embed = new EmbedBuilder()
    .setColor('#ffd900')
    .setTitle('ÃƒÂ°Ã…Â¸Ã…Â¡Ã…â€œ Kreiranje zadatka ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ Korak 1')
    .setDescription('Odaberi polje za koje Ãƒâ€¦Ã‚Â¾eliÃƒâ€¦Ã‚Â¡ kreirati posao.');

  await interaction.reply({
    embeds: [embed],
    components: rows,
    ephemeral: true,
  });
  return;
}


// === OPÃƒâ€žÃ¢â‚¬Â I ZADATAK: START (BEZ POLJA) ===
if (interaction.customId === 'task_general_start') {
  const modal = new ModalBuilder()
    .setCustomId('task_general_modal')
    .setTitle('ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Novi zadatak');

  const titleInput = new TextInputBuilder()
    .setCustomId('task_title')
    .setLabel('Naziv zadatka')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const descInput = new TextInputBuilder()
    .setCustomId('task_description')
    .setLabel('Opis (opcionalno)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(descInput)
  );

  await interaction.showModal(modal);
  return;
}


    // === FARMING: ODABIR POLJA ===
    if (interaction.customId.startsWith('task_field_')) {
      const fieldId = interaction.customId.replace('task_field_', '');

      const current = activeTasks.get(interaction.user.id) || {};
      current.field = fieldId;
      activeTasks.set(interaction.user.id, current);

      const embed = new EmbedBuilder()
        .setColor('#00a84d')
        .setTitle('ÃƒÂ°Ã…Â¸Ã…Â¡Ã…â€œ Kreiranje zadatka ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ Korak 2')
        .setDescription(
          `Odabrano polje: **Polje ${fieldId}**\n\nSada odaberi vrstu posla:`
        );

      const jobsRow1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('task_job_oranje')
          .setLabel('Oranje')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_lajn')
          .setLabel('Bacanje lajma')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_djubrenje')
          .setLabel('Ãƒâ€žÃ‚Âubrenje')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_tanjiranje')
          .setLabel('Kultiviranje')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_podrivanje')
          .setLabel('Podrivanje')
          .setStyle(ButtonStyle.Primary)
      );

      const jobsRow2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('task_job_herbicid')
          .setLabel('Herbicid')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_kosnja_trave')
          .setLabel('KoÃƒâ€¦Ã‚Â¡nja trave')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_kosnja_djeteline')
          .setLabel('KoÃƒâ€¦Ã‚Â¡nja djeteline')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_kombajniranje_modal')
          .setLabel('Kombajniranje')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('task_job_sijanje')
          .setLabel('Sijanje')
          .setStyle(ButtonStyle.Success)
      );

      const jobsRow3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('task_job_malciranje')
          .setLabel('MalÃƒâ€žÃ‚Âiranje')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_spajanje')
          .setLabel('Spajanje polja')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_baliranje')
          .setLabel('Baliranje')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_skupljanje')
          .setLabel('Skupljanje u redove')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_okretanje')
          .setLabel('Prevrtanje trave / djeteline')
          .setStyle(ButtonStyle.Primary)
      );

      const jobsRow4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('task_job_zamotavanje')
          .setLabel('Zamotati bale za silaÃƒâ€¦Ã‚Â¾u')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_zimska')
          .setLabel('Zimska brazda')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_ceste')
          .setLabel('Ãƒâ€žÃ…â€™iÃƒâ€¦Ã‚Â¡Ãƒâ€žÃ¢â‚¬Â¡enje ceste')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_rolanje')
          .setLabel('Rolanje polja')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_silaza')
          .setLabel('SilaÃƒâ€¦Ã‚Â¾a')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.update({
        embeds: [embed],
        components: [jobsRow1, jobsRow2, jobsRow3, jobsRow4],
      });
      return;
      
    }

    // === FARMING: ODABIR POSLA (sve osim sijanja i kombajniranja s modalom) ===
    if (
      interaction.customId.startsWith('task_job_') &&
      interaction.customId !== 'task_job_sijanje' &&
      interaction.customId !== 'task_job_kombajniranje_modal'
    ) {
      const current = activeTasks.get(interaction.user.id);


if (!current || !current.field) {
  return interaction.reply({
    content: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Nije pronaÃƒâ€žÃ¢â‚¬Ëœeno polje.',
    ephemeral: true,
  });
}

const jobKey = interaction.customId.replace('task_job_', '');
const jobNames = {
  oranje: 'Oranje',
  lajn: 'Bacanje lajma',
  djubrenje: 'Ãƒâ€žÃ‚Âubrenje',
  tanjiranje: 'Kultiviranje',
  podrivanje: 'Podrivanje',
  herbicid: 'Prskanje herbicidom',
  kosnja_trave: 'KoÃƒâ€¦Ã‚Â¡nja trave',
  kosnja_djeteline: 'KoÃƒâ€¦Ã‚Â¡nja djeteline',
  malciranje: 'MalÃƒâ€žÃ‚Âiranje',
  spajanje: 'Spajanje polja',
  baliranje: 'Baliranje',
  skupljanje: 'Skupljanje u redove',
  okretanje: 'Prevrtanje trave / djeteline',
  zamotavanje: 'Zamotati bale za silaÃƒâ€¦Ã‚Â¾u',
  zimska: 'Zimska brazda',
  ceste: 'Ãƒâ€žÃ…â€™iÃƒâ€¦Ã‚Â¡Ãƒâ€žÃ¢â‚¬Â¡enje ceste',
  rolanje: 'Rolanje polja',
  silaza: 'SilaÃƒâ€¦Ã‚Â¾a',
};

current.jobKey = jobKey;
current.jobName = jobNames[jobKey] || jobKey;
activeTasks.set(interaction.user.id, current);


      // ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â OVDJE VIÃƒâ€¦Ã‚Â E NE KREIRAÃƒâ€¦Ã‚Â  ZADATAK

const embed = new EmbedBuilder()
  .setColor('#5865f2')
  .setTitle('ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¦ Odaberi prioritet posla')
  .setDescription(
    `ÃƒÂ°Ã…Â¸Ã…Â¡Ã…â€œ **Polje:** ${current.field}\n` +
    `ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂºÃ‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â **Posao:** ${current.jobName}\n\n` +
    'Odaberi prioritet:'
  );

const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('task_priority_hitno')
    .setLabel('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â´ HITNO')
    .setStyle(ButtonStyle.Danger),
  new ButtonBuilder()
    .setCustomId('task_priority_visok')
    .setLabel('ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â  Visok')
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId('task_priority_srednji')
    .setLabel('ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â¡ Srednji')
    .setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId('task_priority_nizak')
    .setLabel('ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â¢ Nizak')
    .setStyle(ButtonStyle.Success)
);

// VAÃƒâ€¦Ã‚Â½NO
return interaction.update({
  embeds: [embed],
  components: [row],
});

    }

// ==============================
// 3ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÂ¢Ã†â€™Ã‚Â£ PRIORITET ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ KREIRANJE POSLA
// ==============================
if (interaction.customId.startsWith('task_priority_')) {
  const current = activeTasks.get(interaction.user.id);
  if (!current) {
    return interaction.reply({
      content: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Nema aktivnog zadatka.',
      ephemeral: true,
    });
  }

  const priorities = {
    hitno:   { label: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â´ HITNO', value: 4, color: '#ff0000' },
    visok:   { label: 'ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â  Visok', value: 3, color: '#ffa500' },
    srednji: { label: 'ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â¡ Srednji', value: 2, color: '#ffd000' },
    nizak:   { label: 'ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â¢ Nizak', value: 1, color: '#3ba55d' },
  };

  const key = interaction.customId.replace('task_priority_', '');
  const prio = priorities[key];
  if (!prio) return;

  // ==============================
  // ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â OPÃƒâ€žÃ¢â‚¬Â I ZADATAK (BEZ POLJA)
  // ==============================
  if (current.type === 'general') {
    const embed = new EmbedBuilder()
      .setColor(prio.color)
      .setTitle(`${prio.label} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Zadatak`)
      .addFields(
        { name: 'Zadatak', value: current.title, inline: false },
        ...(current.description
          ? [{ name: 'Opis', value: current.description, inline: false }]
          : []),
        { name: 'Izradio', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('task_done')
        .setLabel('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ ZavrÃƒâ€¦Ã‚Â¡i zadatak')
        .setStyle(ButtonStyle.Success)
    );

    const jobChannel = await interaction.guild.channels.fetch(FS_JOB_CHANNEL_ID);
    const sentMsg = await jobChannel.send({
      embeds: [embed],
      components: [row],
    });

    saveFarmingTask({
      type: 'general',
      title: current.title,
      description: current.description,
      priority: key,
      priorityLabel: prio.label,
      priorityValue: prio.value,
      status: 'open',
      channelId: jobChannel.id,
      messageId: sentMsg.id,
      createdBy: interaction.user.id,
      createdAt: new Date().toISOString(),
    });

    activeTasks.delete(interaction.user.id);

    return interaction.reply({
      content: 'ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ OpÃƒâ€žÃ¢â‚¬Â¡i zadatak je kreiran.',
      ephemeral: true,
    });
  }

  // ==============================
  // ÃƒÂ°Ã…Â¸Ã…Â¡Ã…â€œ FARMING POSAO (POLJA)
  // ==============================
  if (!current.field || !current.jobName) {
    return interaction.reply({
      content: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Nema aktivnog farming zadatka.',
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(prio.color)
    .setTitle(`${prio.label} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Novi zadatak`)
    .addFields(
      { name: 'Polje', value: `Polje ${current.field}`, inline: true },
      { name: 'Posao', value: current.jobName, inline: true },
      { name: 'Izradio', value: `<@${interaction.user.id}>`, inline: true },
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('task_done')
      .setLabel('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ ZavrÃƒâ€¦Ã‚Â¡i zadatak')
      .setStyle(ButtonStyle.Success)
  );

  const jobChannel = await interaction.guild.channels.fetch(FS_JOB_CHANNEL_ID);
  const sentMsg = await jobChannel.send({
    embeds: [embed],
    components: [row],
  });

  saveFarmingTask({
    field: current.field,
    jobKey: current.jobKey,
    jobName: current.jobName,
    priority: key,
    priorityLabel: prio.label,
    priorityValue: prio.value,
    status: 'open',
    fromFs: false,
    channelId: jobChannel.id,
    messageId: sentMsg.id,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
  });

  activeTasks.delete(interaction.user.id);

  return interaction.reply({
    content: 'ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Farming zadatak je uspjeÃƒâ€¦Ã‚Â¡no kreiran.',
    ephemeral: true,
  });
}



    // === FARMING: Sijanje ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ otvaranje modala ===
    if (interaction.customId === 'task_job_sijanje') {
      const current = activeTasks.get(interaction.user.id);
      if (!current || !current.field) {
        await interaction.reply({
          content:
            'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Nije pronaÃƒâ€žÃ¢â‚¬Ëœeno polje. PokuÃƒâ€¦Ã‚Â¡aj ponovno klikom na ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Kreiraj posaoÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ.',
          ephemeral: true,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('task_sowing_modal')
        .setTitle('Sijanje ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ unos kulture');

      const input = new TextInputBuilder()
        .setCustomId('seed_name')
        .setLabel('Ãƒâ€¦Ã‚Â to se sije? (npr. kukuruz, jeÃƒâ€žÃ‚Âam...)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    // === FARMING: Kombajniranje ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ otvaranje modala ===
    if (interaction.customId === 'task_job_kombajniranje_modal') {
      const current = activeTasks.get(interaction.user.id);
      if (!current || !current.field) {
        await interaction.reply({
          content:
            'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Nije pronaÃƒâ€žÃ¢â‚¬Ëœeno polje. PokuÃƒâ€¦Ã‚Â¡aj ponovno klikom na ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Kreiraj posaoÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ.',
          ephemeral: true,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('task_harvest_modal')
        .setTitle('Kombajniranje ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ unos detalja');

      const input = new TextInputBuilder()
        .setCustomId('harvest_info')
        .setLabel('Ãƒâ€¦Ã‚Â to se kombajnira? (npr. pÃƒâ€¦Ã‚Â¡enica, soja...)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    // === FARMING: oznaÃƒâ€žÃ‚Âi zadatak kao zavrÃƒâ€¦Ã‚Â¡en ruÃƒâ€žÃ‚Âno ===
if (interaction.customId === 'task_done') {
  const oldEmbed = interaction.message.embeds[0];

  if (!oldEmbed) {
    await interaction.reply({
      content: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ne mogu pronaÃƒâ€žÃ¢â‚¬Â¡i podatke o zadatku.',
      ephemeral: true,
    });
    return;
  }

  // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â PRONAÃƒâ€žÃ‚ÂI ZADATAK U DB-u PO PORUKI
  const db = loadDb();
  const task = db.farmingTasks.find(t => t.messageId === interaction.message.id);

  // ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ Ako je ovo bio zadatak SIJANJA ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ upis u sezonu
  if (task && task.jobKey === 'sijanje') {
    const cropName = task.cropName || task.jobName || "nepoznato";

    // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§ FIX ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ upiÃƒâ€¦Ã‚Â¡i cropName u DB ako nedostaje
if (!task.cropName) {
    task.cropName = cropName;
    saveDb(db);
}


    try {
    console.log("ÃƒÂ¢Ã…Â¾Ã‚Â¡ PokreÃƒâ€žÃ¢â‚¬Â¡em ruÃƒâ€žÃ‚Âni upis sjetve u sezonu...");
    await handleNewSowingTask(interaction.guild, task.field, cropName);
    console.log(`ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ RuÃƒâ€žÃ‚Âno zavrÃƒâ€¦Ã‚Â¡avanje sjetve ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ Polje ${task.field}: ${cropName}`);

    // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â¥ PRISILNI REFRESH EMBEDA
    await updateSeasonEmbed(interaction.guild);
    console.log("ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â¾ Embed sezone ruÃƒâ€žÃ‚Âno osvjeÃƒâ€¦Ã‚Â¾en.");
} catch (err) {
    console.error("ÃƒÂ¢Ã‚ÂÃ…â€™ GreÃƒâ€¦Ã‚Â¡ka pri ruÃƒâ€žÃ‚Ânom upisu sjetve:", err);
}

  }

  // ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ GENERIRAJ NOVI EMBED O ZAVRÃƒâ€¦Ã‚Â ETKU
  const finishedEmbed = EmbedBuilder.from(oldEmbed)
    .setColor('#ff0000')
    .setTitle('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Zadatak zavrÃƒâ€¦Ã‚Â¡en')
    .setFooter({
      text: 'OznaÃƒâ€žÃ‚Âeno kao zavrÃƒâ€¦Ã‚Â¡eno od strane: ' + interaction.user.tag,
    })
    .setTimestamp();

  const doneChannel = await interaction.guild.channels.fetch(FS_JOB_DONE_CHANNEL_ID);

  await doneChannel.send({ embeds: [finishedEmbed] });

  await interaction.reply({
    content:
      'ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Zadatak je oznaÃƒâ€žÃ‚Âen kao zavrÃƒâ€¦Ã‚Â¡en i prebaÃƒâ€žÃ‚Âen u kanal za zavrÃƒâ€¦Ã‚Â¡ene poslove.',
    ephemeral: true,
  });

  await interaction.message.delete().catch(() => {});
  return;
}


    // === TICKET DUGMAD: CLAIM & CLOSE ===
    if (
      interaction.customId === 'ticket_claim' ||
      interaction.customId === 'ticket_close'
    ) {
      const hasStaffPerms = interaction.member.permissions.has(
        PermissionFlagsBits.ManageChannels
      );

      if (!hasStaffPerms) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â Samo staff/admin moÃƒâ€¦Ã‚Â¾e koristiti ovu opciju.',
          ephemeral: true,
        });
      }

      // svaki put kad staff dira tiket, ugasi reminder i inactivity
      stopTicketReminder(interaction.channel.id);
      stopTicketInactivity(interaction.channel.id);

      const channel = interaction.channel;
      const guild = interaction.guild;

      const topic = channel.topic || '';
      const match = topic.match(/Ticket owner:\s*(\d+)/i);
      const ticketOwnerId = match ? match[1] : null;

      if (interaction.customId === 'ticket_claim') {
        await upsertTicketRecord({
          guildId: guild.id,
          userId: ticketOwnerId || '',
          username: '',
          ticketType: (topic.match(/Type:\s*([^\s|]+)/i) || [])[1] || '',
          ticketTitle: channel.name,
          status: 'claimed',
          channelId: channel.id,
          channelName: channel.name,
          claimedById: interaction.user.id,
          claimedByTag: interaction.user.tag,
        }).catch((err) => {
          console.log('TICKET RECORD CLAIM ERROR:', err.message);
        });

        await interaction.reply({
          content: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Ticket je preuzeo/la ${interaction.user}.`,
        });
        return;
      }

      if (interaction.customId === 'ticket_close') {
        await interaction.reply({
          content: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â„¢ Ticket je zatvoren. Kanal je oznaÃƒâ€žÃ‚Âen kao zatvoren.',
          ephemeral: true,
        });

        if (!channel.name.startsWith('closed-')) {
          await channel.setName(`closed-${channel.name}`).catch(() => {});
        }

        await channel.permissionOverwrites.edit(guild.roles.everyone, {
          SendMessages: false,
          AddReactions: false,
        }).catch(() => {});

        if (ticketOwnerId) {
          await channel.permissionOverwrites.edit(ticketOwnerId, {
            SendMessages: false,
            AddReactions: false,
          }).catch(() => {});
        }

        if (SUPPORT_ROLE_ID) {
          await channel.permissionOverwrites.edit(SUPPORT_ROLE_ID, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          }).catch(() => {});
        }

        await channel.permissionOverwrites.edit(client.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => {});

        const transcriptText = await sendTicketTranscript(channel, interaction.user);

        await upsertTicketRecord({
          guildId: guild.id,
          userId: ticketOwnerId || '',
          username: '',
          ticketType: (topic.match(/Type:\s*([^\s|]+)/i) || [])[1] || '',
          ticketTitle: channel.name,
          status: 'closed',
          channelId: channel.id,
          channelName: channel.name,
          closedById: interaction.user.id,
          closedByTag: interaction.user.tag,
          closeReason: 'manual_close',
          transcriptText,
        }).catch((err) => {
          console.log('TICKET RECORD CLOSE ERROR:', err.message);
        });

        setTimeout(() => {
          channel.delete().catch(() => {});
        }, 10_000);

        return;
      }
    }
  }

  // ---------- MODALI (FIELD ADD + SIJANJE + KOMBAJNIRANJE) ----------
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('ticket_answers:')) {
      const [, type] = interaction.customId.split(':');
      const cfg = getTicketConfig();
      const typeCfg = cfg.types[type];
      const state = pendingTicketForms.get(interaction.user.id);
      const blacklistEntry = await getTicketBlacklistEntry(
        interaction.guild?.id,
        interaction.user.id
      );

      if (blacklistEntry) {
        pendingTicketForms.delete(interaction.user.id);
        return interaction.reply({
          content:
            'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â Ne mozes zavrsiti otvaranje ticketa jer si na ticket blackliste.' +
            (blacklistEntry.reason ? `\nRazlog: ${blacklistEntry.reason}` : ''),
          ephemeral: true,
        });
      }

      if (!typeCfg || !state || state.type !== type) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ticket forma je istekla. Otvori ticket ponovno iz panela.',
          ephemeral: true,
        });
      }

      const requiresAge = ticketTypeRequiresAge(type);
      const ageRaw = requiresAge
        ? interaction.fields.getTextInputValue('age').trim()
        : '';
      const age = requiresAge ? Number.parseInt(ageRaw, 10) : null;
      const questionAnswers = (Array.isArray(state.questions) ? state.questions : [])
        .slice(0, 4)
        .map((question, index) => ({
          question,
          answer: interaction.fields.getTextInputValue(`question_${index}`).trim(),
        }));
      const answersBlob = questionAnswers
        .map((entry, index) => `${index + 1}. ${entry.question}\n${entry.answer}`)
        .join('\n\n');
      const modalAnswers = requiresAge
        ? [{ question: 'Koliko imaÃƒâ€¦Ã‚Â¡ godina?', answer: String(age) }, ...questionAnswers]
        : questionAnswers;
      const submissionAnswersText = requiresAge
        ? [`Koliko imaÃƒâ€¦Ã‚Â¡ godina?\n${age}`, ...questionAnswers.map((entry, index) => `${index + 1}. ${entry.question}\n${entry.answer}`)].join('\n\n')
        : answersBlob;

      if (requiresAge && (!Number.isInteger(age) || age <= 0)) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Polje za godine mora sadrÃƒâ€¦Ã‚Â¾avati ispravan broj.',
          ephemeral: true,
        });
      }

      if (requiresAge && age < 18) {
        pendingTicketForms.delete(interaction.user.id);
        await saveTicketSubmission({
          guildId: interaction.guild?.id,
          userId: interaction.user.id,
          username: interaction.user.tag,
          ticketType: type,
          status: 'rejected_underage',
          age,
          isAdult: false,
          channelId: null,
          questions: state.questions,
          answersText: submissionAnswersText,
        }).catch((err) => {
          console.log('TICKET SUBMISSION SAVE ERROR:', err.message);
        });

        return interaction.reply({
          content: 'ÃƒÂ¢Ã‚ÂÃ…â€™ Tvoja prijava je odbijena radi maloljetnosti. Minimalna dob za ovaj ticket je 18 godina.',
          ephemeral: true,
        });
      }

      const channel = await openTicketChannelFromModalAnswers({
        guild: interaction.guild,
        member: interaction.member,
        type,
        cfg,
        typeCfg,
        age,
        questions: state.questions,
        answersText: submissionAnswersText,
        answers: modalAnswers,
      });

      if (type === 'igranje' && PLAYER_ROLE_ID) {
        await interaction.member.roles.add(PLAYER_ROLE_ID).catch((err) => {
          console.log('PLAYER ROLE ADD ERROR:', err.message);
        });
      }

      pendingTicketForms.delete(interaction.user.id);
      await saveTicketSubmission({
        guildId: interaction.guild?.id,
        userId: interaction.user.id,
        username: interaction.user.tag,
        ticketType: type,
        status: 'opened',
        age,
        isAdult: requiresAge ? true : null,
        channelId: channel.id,
        questions: state.questions,
        answersText: submissionAnswersText,
      }).catch((err) => {
        console.log('TICKET SUBMISSION SAVE ERROR:', err.message);
      });

      return interaction.reply({
        content: `Tvoj ticket je otvoren: ${channel}`,
        ephemeral: true,
      });
    }

    // Dodavanje novog polja
    if (interaction.customId === 'field_add_modal') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â Samo staff/admin moÃƒâ€¦Ã‚Â¾e dodavati polja.',
          ephemeral: true,
        });
      }

      const value = interaction.fields.getTextInputValue('field_value').trim();

      if (!value) {
        return interaction.reply({
          content: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â MoraÃƒâ€¦Ã‚Â¡ upisati oznaku polja.',
          ephemeral: true,
        });
      }

      const fields = getFarmingFields();
      if (fields.includes(value)) {
        return interaction.reply({
          content: `ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Polje **${value}** veÃƒâ€žÃ¢â‚¬Â¡ postoji u listi.`,
          ephemeral: true,
        });
      }

      fields.push(value);
      saveFarmingFields(fields);

      return interaction.reply({
        content: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Polje **${value}** je dodano u listu. Dostupno je u task-panelu.`,
        ephemeral: true,
      });
    }

    // ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â OPÃƒâ€žÃ¢â‚¬Â I ZADATAK ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ MODAL SUBMIT ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ PRIORITET
if (interaction.customId === 'task_general_modal') {
  const title = interaction.fields.getTextInputValue('task_title');
  const description =
    interaction.fields.getTextInputValue('task_description') || '';

  activeTasks.set(interaction.user.id, {
    type: 'general',
    title,
    description,
  });

  const embed = new EmbedBuilder()
    .setColor('#5865f2')
    .setTitle('ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¦ Odaberi prioritet')
    .setDescription(
      `ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â **Zadatak:** ${title}\n` +
      (description ? `ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Å¾ ${description}\n\n` : '\n') +
      'Odaberi prioritet:'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('task_priority_hitno')
      .setLabel('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â´ HITNO')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('task_priority_visok')
      .setLabel('ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â  Visok')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('task_priority_srednji')
      .setLabel('ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â¡ Srednji')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('task_priority_nizak')
      .setLabel('ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â¢ Nizak')
      .setStyle(ButtonStyle.Success)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
  return;
}



    // Sijanje
    if (interaction.customId === 'task_sowing_modal') {
      const current = activeTasks.get(interaction.user.id);
      if (!current || !current.field) {
        await interaction.reply({
          content:
            'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ne mogu pronaÃƒâ€žÃ¢â‚¬Â¡i odabrano polje. PokuÃƒâ€¦Ã‚Â¡aj ponovno od poÃƒâ€žÃ‚Âetka.',
          ephemeral: true,
        });
        return;
      }

      const seedName = interaction.fields.getTextInputValue('seed_name');

      // ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â± Sezona Sjetve ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ registracija novog posijanog polja
      await handleNewSowingTask(interaction.guild, current.field, seedName);


      const embed = new EmbedBuilder()
        .setColor('#00a84d')
        .setTitle('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Novi zadatak kreiran')
        .addFields(
          { name: 'Polje', value: `Polje ${current.field}`, inline: true },
          { name: 'Posao', value: 'Sijanje', inline: true },
          { name: 'Kultura', value: seedName, inline: true },
          { name: 'Izradio', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setTimestamp();

      const doneRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('task_done')
          .setLabel('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Zadatak zavrÃƒâ€¦Ã‚Â¡en')
          .setStyle(ButtonStyle.Success)
      );

      const jobChannel = await interaction.guild.channels.fetch(
        FS_JOB_CHANNEL_ID
      );

      await interaction.reply({
        content:
          'ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Zadatak za sijanje je kreiran i objavljen u kanalu za poslove.',
        ephemeral: true,
      });

      const sentMsg = await jobChannel.send({
        embeds: [embed],
        components: [doneRow],
      });

      saveFarmingTask({
        field: current.field,
        jobKey: 'sijanje',
        jobName: 'Sijanje',
        cropName: seedName,
        status: 'open',
        fromFs: false,
        channelId: jobChannel.id,
        messageId: sentMsg.id,
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
      });

      activeTasks.delete(interaction.user.id);
      return;
    }

    // === UPDATE FIELD ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ STEP 2 (kompletan rename sistema) ===
if (interaction.customId.startsWith("update_field_step2_")) {
    const oldField = interaction.customId.replace("update_field_step2_", "");
    const newField = interaction.fields.getTextInputValue("new_field").trim();

    // === 1) UÃƒâ€žÃ‚Âitaj listu polja
    const fields = getFarmingFields();
    const index = fields.indexOf(oldField);

    if (index === -1) {
        return interaction.reply({
            content: `ÃƒÂ¢Ã‚ÂÃ…â€™ GreÃƒâ€¦Ã‚Â¡ka: polje **${oldField}** viÃƒâ€¦Ã‚Â¡e ne postoji.`,
            ephemeral: true,
        });
    }

    if (fields.includes(newField)) {
        return interaction.reply({
            content: `ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Polje **${newField}** veÃƒâ€žÃ¢â‚¬Â¡ postoji.`,
            ephemeral: true,
        });
    }

    // zamijeni u listi polja
    fields[index] = newField;
    saveFarmingFields(fields);

    // === 2) UÃƒâ€žÃ‚Âitaj DB jer mijenjamo joÃƒâ€¦Ã‚Â¡ stvari
    const db = loadDb();

    // === 3) Update u svim farmingTasks
    for (const t of db.farmingTasks) {
        if (t.field === oldField) {
            t.field = newField;
        }
    }

    // odmah spremi
    saveDb(db);


    // === 4) Update embed poruka zadataka (aktivni + zavrÃƒâ€¦Ã‚Â¡eni)
    async function updateTaskEmbeds() {
        const guild = interaction.guild;

        // aktivni channel
        const jobCh = await guild.channels.fetch(FS_JOB_CHANNEL_ID).catch(() => null);
        const doneCh = await guild.channels.fetch(FS_JOB_DONE_CHANNEL_ID).catch(() => null);

        const allTasks = db.farmingTasks.filter(t => t.field === newField);

        for (const t of allTasks) {
            const ch = t.status === "open" ? jobCh : doneCh;
            if (!ch) continue;

            const msg = await ch.messages.fetch(t.messageId).catch(() => null);
            if (!msg || !msg.embeds[0]) continue;

            let embed = EmbedBuilder.from(msg.embeds[0]);

            // Regex: zamjenjuje bilo koji oblik "Polje ... oldField"
            const regex = new RegExp(`Polje\\s*[:\\-]*\\s*${oldField}`, "i");

            embed = embed.toJSON(); // lakÃƒâ€¦Ã‚Â¡e manipulirati

            if (embed.fields) {
                for (const f of embed.fields) {
                    if (regex.test(f.value)) {
                        f.value = f.value.replace(regex, `Polje ${newField}`);
                    }
                }
            }

            await msg.edit({ embeds: [embed] });
        }
    }

    await updateTaskEmbeds();


    // === 5) Update Sowing Season (mora promijeniti kljuÃƒâ€žÃ‚Â)
    const seasons = getSowingSeasons();
    for (const season of seasons) {
        if (season.fields && season.fields[oldField]) {
            season.fields[newField] = season.fields[oldField];
            delete season.fields[oldField];
        }
    }
    saveSowingSeasons(seasons);


    // === 6) Refresh Ãƒâ€¦Ã‚Â¾ivog embed-a sezone
    try {
        await updateSeasonEmbed(interaction.guild);
    } catch (e) {
        console.log("GreÃƒâ€¦Ã‚Â¡ka refresh sezone:", e);
    }


    return interaction.reply({
        content: `ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Polje **${oldField}** je uspjeÃƒâ€¦Ã‚Â¡no preimenovano u **${newField}**.\n\nSve poruke, zadaci i sezona su aÃƒâ€¦Ã‚Â¾urirani.`,
        ephemeral: true,
    });
}



    // Kombajniranje
    if (interaction.customId === 'task_harvest_modal') {
      const current = activeTasks.get(interaction.user.id);
      if (!current || !current.field) {
        await interaction.reply({
          content:
            'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Ne mogu pronaÃƒâ€žÃ¢â‚¬Â¡i odabrano polje. PokuÃƒâ€¦Ã‚Â¡aj ponovno od poÃƒâ€žÃ‚Âetka.',
          ephemeral: true,
        });
        return;
      }

      const harvestInfo = interaction.fields.getTextInputValue('harvest_info');

      const embed = new EmbedBuilder()
        .setColor('#00a84d')
        .setTitle('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Novi zadatak kreiran')
        .addFields(
          { name: 'Polje', value: `Polje ${current.field}`, inline: true },
          { name: 'Posao', value: 'Kombajniranje', inline: true },
          { name: 'Detalji', value: harvestInfo, inline: true },
          { name: 'Izradio', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setTimestamp();

      const doneRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('task_done')
          .setLabel('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Zadatak zavrÃƒâ€¦Ã‚Â¡en')
          .setStyle(ButtonStyle.Success)
      );

      const jobChannel = await interaction.guild.channels.fetch(
        FS_JOB_CHANNEL_ID
      );

      await interaction.reply({
        content:
          'ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Zadatak za kombajniranje je kreiran i objavljen u kanalu za poslove.',
        ephemeral: true,
      });

      const sentMsg = await jobChannel.send({
        embeds: [embed],
        components: [doneRow],
      });

      saveFarmingTask({
        field: current.field,
        jobKey: 'kombajniranje',
        jobName: 'Kombajniranje',
        status: 'open',
        fromFs: false,
        channelId: jobChannel.id,
        messageId: sentMsg.id,
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
      });

      activeTasks.delete(interaction.user.id);
      return;
    }
  }
});

client.login(token).catch((err) => {
  console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Login error:', err);
  
});




