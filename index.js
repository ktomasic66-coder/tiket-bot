// prvo ucitaj .env
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const { createCanvas, registerFont } = require('canvas');
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
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  REST,
  Routes,
  AuditLogEvent,
} = require('discord.js');

const commands = require('./commands');
const { startFs25Bridge } = require('./fs25-discord-bridge');
const {
  postPollPanel,
  handlePollButton,
  handlePollModal,
  initPollStorage,
  restoreActivePolls,
} = require('./utils/pollSystem');

startFs25Bridge().catch((error) => {
  console.error('[fs25-bridge] Startup failed inside bot:', error);
});

const LOCAL_SOWING_TABLE_FONT_FAMILY = 'SowingTableFont';
const LOCAL_SOWING_TABLE_FONT_PATH = path.join(
  __dirname,
  'assets',
  'fonts',
  'arial.ttf'
);

if (fs.existsSync(LOCAL_SOWING_TABLE_FONT_PATH)) {
  try {
    registerFont(LOCAL_SOWING_TABLE_FONT_PATH, {
      family: LOCAL_SOWING_TABLE_FONT_FAMILY,
    });
  } catch (error) {
    console.log('Sowing table font register error:', error.message);
  }
}

function isUnknownInteractionError(error) {
  return error?.code === 10062;
}

const ANNOUNCEMENT_MODAL_ID = 'announcement_modal_create';
const ANNOUNCEMENT_ALLOWED_ROLE_IDS = new Set([
  '1238860450528235550',
  '1487449832061800721',
  '1487464034880979144',
]);
const pendingAnnouncementRoles = new Map();

function memberHasAnyRole(member, roleIds) {
  if (!member?.roles?.cache) return false;
  for (const roleId of roleIds) {
    if (member.roles.cache.has(roleId)) {
      return true;
    }
  }
  return false;
}

function buildAnnouncementModal() {
  const titleInput = new TextInputBuilder()
    .setCustomId('announcement_title')
    .setLabel('Naslov')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(120)
    .setPlaceholder('npr. Vazna obavijest');

  const descriptionInput = new TextInputBuilder()
    .setCustomId('announcement_description')
    .setLabel('Opis')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setPlaceholder('Upisi announcement poruku...');

  return new ModalBuilder()
    .setCustomId(ANNOUNCEMENT_MODAL_ID)
    .setTitle('Announcement')
    .addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descriptionInput)
    );
}

// 🔹 ENV varijable
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID?.trim();

const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID; // rola za support
const PLAYER_ROLE_ID = '1487449859182039060';
// secret za Farming Server webhooks
const FS_WEBHOOK_SECRET = process.env.FS_WEBHOOK_SECRET;
const BLACKLIST_LOG_CHANNEL_ID = '1483576763811364935';
const BLACKLIST_ROLE_ID = '1483578948611866714';
const DISCORD_BAN_PANEL_CHANNEL_ID = '1487452042481106994';
const DISCORD_BAN_PANEL_TITLE = 'Discord Ban Lista';
const DISCORD_BAN_PANEL_PAGE_SIZE = 5;
const DISCORD_BAN_PANEL_MENU_PAGE_SIZE = 25;

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
  supportRoleId: '',              // support rola (ako želiš override env-a)
  launcherChannelId: '1481028377489047613',
  autoCloseHours: 48,             // nakon koliko sati neaktivnosti se auto zatvara
  reminderHours: 3,               // svakih koliko minuta ide podsjetnik
  types: {
    igranje: {
      title: 'Igranje na serveru',
      questions: [
        'Koliko često planiraš igrati na serveru?',
        'U koje vrijeme si najčešće aktivan?',
        'Zašto želiš igrati baš na našem serveru?',
        'Jesi li spreman poštovati pravila, dogovore i obaveze na farmi?',
      ],
    },
    zalba: {
      title: 'Žalba na igrače',
      questions: [
        'Ime igrača na kojeg se žališ?',
        'Vrijeme i detaljan opis situacije?',
        'Imaš li dokaze (slike, video, log)?',
      ],
    },
    modovi: {
      title: 'Edit modova',
      questions: [
        'Na čemu trenutno radiš?',
        'Koji je konkretan problem?',
        'Koji editor / verziju igre koristiš?',
      ],
    },
    pomoc: {
      title: 'Pomoć',
      questions: [
        'U čemu ti treba pomoć?',
        'Je li problem hitan?',
        'Na koga ili na što se odnosi problem?',
        'Dodaj detalje da admin zna što treba pogledati',
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

// 🔹 default polja za Farming zadatke (prebacujemo iz koda u db.json)
const DEFAULT_FARMING_FIELDS = [];
const KNOWN_FARM_KEYS = ['farm1', 'farm2', 'farm3'];
const FARM_LABELS = {
  farm1: 'Farma 1',
  farm2: 'Farma 2',
  farm3: 'Farma 3',
};
const TASK_PANEL_COMMAND_TO_FARM = {
  task1: 'farm1',
  task2: 'farm2',
  task3: 'farm3',
};

function buildFarmState(factory) {
  return KNOWN_FARM_KEYS.reduce((acc, farmKey) => {
    acc[farmKey] = factory(farmKey);
    return acc;
  }, {});
}

function buildDefaultFarmingFields() {
  return buildFarmState((farmKey) =>
    farmKey === 'farm1' ? [...DEFAULT_FARMING_FIELDS] : []
  );
}

// default sezonski podaci za sjetvu
const DEFAULT_SOWING_SEASONS = [];
const SOWING_TABLE_CHANNEL_IDS = {
  farm1: '1494813331842662511',
  farm2: '1494807191113433229',
  farm3: '1496980804713320581',
};
const SOWING_TABLE_CHANNEL_ID = SOWING_TABLE_CHANNEL_IDS.farm2;
const DEFAULT_SOWING_TABLE = {
  messageId: null,
  yearLabels: ['1 GOD', '2 GOD', '3 GOD', '4 GOD'],
  rows: [],
};
function buildDefaultSowingTable(channelId = '') {
  return {
    messageId: null,
    channelId: String(channelId || '').trim(),
    yearLabels: [...DEFAULT_SOWING_TABLE.yearLabels],
    rows: [],
  };
}

const DEFAULT_SOWING_TABLES = buildFarmState((farmKey) =>
  buildDefaultSowingTable(SOWING_TABLE_CHANNEL_IDS[farmKey])
);


function getDefaultData() {
  return {
    welcome: {
      channelId: '',
      message: 'Dobrodošao {user} na server!',
    },
    logging: {
      channelId: '',
    },
    embeds: [],
    ticketBlacklist: [],
    ticketSubmissions: [],
    ticketRecords: [],
    discordBanPanel: {
      channelId: DISCORD_BAN_PANEL_CHANNEL_ID,
      messageId: null,
    },
    discordBanRecords: [],
    ticketSystem: JSON.parse(JSON.stringify(DEFAULT_TICKET_SYSTEM)),
    // 🔹 ovdje ćemo spremati aktivne/završene FS zadatke (da ih možemo naći po polju)
    farmingTasks: [],
    farmingTaskPanelMessageIds: buildFarmState(() => null),
    farmingFields: buildDefaultFarmingFields(),
    farmingFieldListMessageId: null,
    sowingSeasons: [...DEFAULT_SOWING_SEASONS],   // ✅ OVO NEDOSTAJE
    sowingTables: JSON.parse(JSON.stringify(DEFAULT_SOWING_TABLES)),
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
    discordBanPanel: {
      ...base.discordBanPanel,
      ...(data.discordBanPanel || {}),
    },
    discordBanRecords: Array.isArray(data.discordBanRecords)
      ? data.discordBanRecords
      : base.discordBanRecords,
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
    farmingTaskPanelMessageIds: {
      ...base.farmingTaskPanelMessageIds,
      ...(data.farmingTaskPanelMessageIds || {}),
    },
    farmingFields: normalizeFarmingFields(data.farmingFields),
    farmingFieldListMessageId:
      typeof data.farmingFieldListMessageId === 'string' || data.farmingFieldListMessageId === null
        ? data.farmingFieldListMessageId
        : base.farmingFieldListMessageId,
    sowingSeasons: Array.isArray(data.sowingSeasons) ? data.sowingSeasons : base.sowingSeasons,
    sowingTables: normalizeSowingTables(data.sowingTables || data.sowingTable),
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
let sharedConfigUpdatedAt = 0;

async function readSharedBotConfigRow() {
  if (!useMySql || !dbPool) return null;

  const [rows] = await dbPool.query(
    'SELECT config_value, updated_at FROM bot_config WHERE config_key = ? LIMIT 1',
    ['ticket-bot']
  );

  return rows.length ? rows[0] : null;
}

function mergeRemoteSharedConfigIntoCache(remoteData) {
  const mergedRemote = mergeDbData(remoteData);

  dbCache = mergeDbData({
    ...mergedRemote,
    ticketBlacklist: Array.isArray(dbCache.ticketBlacklist) ? dbCache.ticketBlacklist : [],
    ticketSubmissions: Array.isArray(dbCache.ticketSubmissions) ? dbCache.ticketSubmissions : [],
    ticketRecords: Array.isArray(dbCache.ticketRecords) ? dbCache.ticketRecords : [],
    discordBanPanel: {
      ...getDefaultData().discordBanPanel,
      ...(mergedRemote.discordBanPanel || {}),
    },
    discordBanRecords: Array.isArray(mergedRemote.discordBanRecords)
      ? mergedRemote.discordBanRecords
      : [],
    farmingTasks: Array.isArray(mergedRemote.farmingTasks) ? mergedRemote.farmingTasks : [],
    farmingTaskPanelMessageIds: {
      ...getDefaultData().farmingTaskPanelMessageIds,
      ...(mergedRemote.farmingTaskPanelMessageIds || {}),
    },
    farmingFields: normalizeFarmingFields(mergedRemote.farmingFields),
    farmingFieldListMessageId:
      typeof mergedRemote.farmingFieldListMessageId === 'string' ||
      mergedRemote.farmingFieldListMessageId === null
        ? mergedRemote.farmingFieldListMessageId
        : null,
    sowingSeasons: Array.isArray(mergedRemote.sowingSeasons) ? mergedRemote.sowingSeasons : [],
    sowingTables: normalizeSowingTables(mergedRemote.sowingTables || mergedRemote.sowingTable),
  });
}

async function refreshSharedBotConfigFromMySql(force) {
  if (!useMySql || !dbPool) return false;

  try {
    const row = await readSharedBotConfigRow();
    if (!row) return false;

    const updatedAtMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    if (!force && updatedAtMs && updatedAtMs <= sharedConfigUpdatedAt) return false;

    mergeRemoteSharedConfigIntoCache(JSON.parse(row.config_value));
    sharedConfigUpdatedAt = updatedAtMs || Date.now();
    return true;
  } catch (err) {
    console.log('Shared bot config refresh error:', err.message);
    return false;
  }
}

async function readFarmingFieldsFromMySql() {
  if (!useMySql || !dbPool) return null;

  const [rows] = await dbPool.query(
    `SELECT farm_key, field_value
     FROM farming_fields
     ORDER BY farm_key ASC, field_value ASC`
  );

  if (!rows.length) return null;

  const grouped = buildFarmState(() => []);
  for (const row of rows) {
    const farmKey = String(row.farm_key || '').trim();
    if (!grouped[farmKey]) grouped[farmKey] = [];
    grouped[farmKey].push(String(row.field_value));
  }

  return normalizeFarmingFields(grouped);
}

async function persistFarmingFieldsToMySql(fieldsByFarm) {
  if (!useMySql || !dbPool) return;

  const normalized = normalizeFarmingFields(fieldsByFarm);
  const rows = [];

  for (const farmKey of Object.keys(normalized)) {
    for (const fieldValue of normalized[farmKey]) {
      rows.push([farmKey, String(fieldValue)]);
    }
  }

  const conn = await dbPool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM farming_fields');

    if (rows.length) {
      await conn.query(
        'INSERT INTO farming_fields (farm_key, field_value) VALUES ?',
        [rows]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function readSowingTableRowsFromMySql() {
  if (!useMySql || !dbPool) return null;

  const [rows] = await dbPool.query(
    `SELECT farm_key, field_value, year1_value, year2_value, year3_value, year4_value
     FROM sowing_table_rows
     ORDER BY farm_key ASC, field_value ASC`
  );

  if (!rows.length) return null;

  const grouped = buildFarmState(() => []);
  for (const row of rows) {
    const farmKey = String(row.farm_key || '').trim();
    if (!grouped[farmKey]) grouped[farmKey] = [];
    grouped[farmKey].push({
      field: row.field_value,
      year1: row.year1_value,
      year2: row.year2_value,
      year3: row.year3_value,
      year4: row.year4_value,
    });
  }

  return buildFarmState((farmKey) => normalizeSowingTableRows(grouped[farmKey]));
}

async function persistSowingTableRowsToMySql(rowsByFarm) {
  if (!useMySql || !dbPool) return;

  const normalizedTables = normalizeSowingTables(rowsByFarm);
  const values = [];

  for (const farmKey of Object.keys(normalizedTables)) {
    for (const row of normalizedTables[farmKey].rows) {
      values.push([
        farmKey,
        row.field,
        row.year1,
        row.year2,
        row.year3,
        row.year4,
      ]);
    }
  }

  const conn = await dbPool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM sowing_table_rows');

    if (values.length) {
      await conn.query(
        `INSERT INTO sowing_table_rows
          (farm_key, field_value, year1_value, year2_value, year3_value, year4_value)
         VALUES ?`,
        [values]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function readDiscordBanRecordsFromMySql(guildIdValue = null) {
  if (!useMySql || !dbPool) return null;

  const params = [];
  let query = `
    SELECT guild_id, user_id, user_tag, reason, banned_at, executor_id, executor_tag
    FROM discord_ban_records
  `;

  if (guildIdValue) {
    query += ' WHERE guild_id = ?';
    params.push(String(guildIdValue || guildId || ''));
  }

  query += ' ORDER BY banned_at DESC, user_tag ASC, user_id ASC';

  const [rows] = await dbPool.query(query, params);
  return rows.map((row) => ({
    guildId: String(row.guild_id || ''),
    userId: String(row.user_id || ''),
    userTag: String(row.user_tag || ''),
    reason: String(row.reason || '').trim(),
    bannedAt: row.banned_at ? new Date(row.banned_at).toISOString() : null,
    executorId: row.executor_id ? String(row.executor_id) : '',
    executorTag: String(row.executor_tag || ''),
  }));
}

async function upsertDiscordBanRecordToMySql(entry) {
  if (!useMySql || !dbPool || !entry?.userId) return;

  await dbPool.query(
    `INSERT INTO discord_ban_records
      (guild_id, user_id, user_tag, reason, banned_at, executor_id, executor_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      user_tag = VALUES(user_tag),
      reason = VALUES(reason),
      banned_at = VALUES(banned_at),
      executor_id = VALUES(executor_id),
      executor_tag = VALUES(executor_tag)`,
    [
      String(entry.guildId || guildId || ''),
      String(entry.userId || ''),
      String(entry.userTag || ''),
      String(entry.reason || '').trim(),
      entry.bannedAt ? new Date(entry.bannedAt) : null,
      entry.executorId ? String(entry.executorId) : null,
      String(entry.executorTag || ''),
    ]
  );
}

async function removeDiscordBanRecordFromMySql(guildIdValue, userId) {
  if (!useMySql || !dbPool) return false;

  const [result] = await dbPool.query(
    'DELETE FROM discord_ban_records WHERE guild_id = ? AND user_id = ?',
    [String(guildIdValue || guildId || ''), String(userId || '')]
  );
  return result.affectedRows > 0;
}

async function replaceDiscordBanRecordsForGuildInMySql(guildIdValue, records) {
  if (!useMySql || !dbPool) return;

  const normalizedGuildId = String(guildIdValue || guildId || '');
  const conn = await dbPool.getConnection();

  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM discord_ban_records WHERE guild_id = ?', [normalizedGuildId]);

    const values = (Array.isArray(records) ? records : [])
      .filter((record) => record?.userId)
      .map((record) => [
        normalizedGuildId,
        String(record.userId || ''),
        String(record.userTag || ''),
        String(record.reason || '').trim(),
        record.bannedAt ? new Date(record.bannedAt) : null,
        record.executorId ? String(record.executorId) : null,
        String(record.executorTag || ''),
      ]);

    if (values.length) {
      await conn.query(
        `INSERT INTO discord_ban_records
          (guild_id, user_id, user_tag, reason, banned_at, executor_id, executor_tag)
         VALUES ?`,
        [values]
      );
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function readDiscordBanPanelStateFromMySql(guildIdValue) {
  if (!useMySql || !dbPool) return null;

  const [rows] = await dbPool.query(
    `SELECT guild_id, channel_id, message_id
     FROM discord_ban_panel_state
     WHERE guild_id = ?
     LIMIT 1`,
    [String(guildIdValue || guildId || '')]
  );

  if (!rows.length) return null;

  return {
    guildId: String(rows[0].guild_id || ''),
    channelId: String(rows[0].channel_id || DISCORD_BAN_PANEL_CHANNEL_ID),
    messageId: rows[0].message_id ? String(rows[0].message_id) : null,
  };
}

async function saveDiscordBanPanelStateToMySql(state) {
  if (!useMySql || !dbPool) return;

  await dbPool.query(
    `INSERT INTO discord_ban_panel_state (guild_id, channel_id, message_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
      channel_id = VALUES(channel_id),
      message_id = VALUES(message_id)`,
    [
      String(state?.guildId || guildId || ''),
      String(state?.channelId || DISCORD_BAN_PANEL_CHANNEL_ID),
      state?.messageId ? String(state.messageId) : null,
    ]
  );
}

async function persistDbCache() {
  if (!useMySql || !dbPool) return;

  let payload = mergeDbData(dbCache);

  try {
    const row = await readSharedBotConfigRow();
    if (row) {
      const remoteData = mergeDbData(JSON.parse(row.config_value));
      payload = mergeDbData({
        ...remoteData,
        ticketBlacklist: payload.ticketBlacklist,
        ticketSubmissions: payload.ticketSubmissions,
        ticketRecords: payload.ticketRecords,
        discordBanPanel: payload.discordBanPanel,
        discordBanRecords: payload.discordBanRecords,
        farmingTasks: payload.farmingTasks,
        farmingTaskPanelMessageIds: payload.farmingTaskPanelMessageIds,
        farmingFields: payload.farmingFields,
        farmingFieldListMessageId: payload.farmingFieldListMessageId,
        sowingSeasons: payload.sowingSeasons,
        sowingTables: payload.sowingTables,
      });
    }
  } catch (err) {
    console.log('Shared bot config merge before save failed:', err.message);
  }

  await dbPool.query(
    `INSERT INTO bot_config (config_key, config_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    ['ticket-bot', JSON.stringify(payload, null, 2)]
  );

  dbCache = payload;
  sharedConfigUpdatedAt = Date.now();
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
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS farming_fields (
        farm_key VARCHAR(20) NOT NULL,
        field_value VARCHAR(120) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (farm_key, field_value)
      )
    `);
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sowing_table_rows (
        farm_key VARCHAR(20) NOT NULL,
        field_value VARCHAR(120) NOT NULL,
        year1_value VARCHAR(160) NOT NULL DEFAULT '',
        year2_value VARCHAR(160) NOT NULL DEFAULT '',
        year3_value VARCHAR(160) NOT NULL DEFAULT '',
        year4_value VARCHAR(160) NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ,PRIMARY KEY (farm_key, field_value)
      )
    `);
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS discord_ban_records (
        guild_id VARCHAR(40) NOT NULL,
        user_id VARCHAR(40) NOT NULL,
        user_tag VARCHAR(120) NULL,
        reason TEXT NULL,
        banned_at TIMESTAMP NULL DEFAULT NULL,
        executor_id VARCHAR(40) NULL,
        executor_tag VARCHAR(120) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, user_id),
        KEY idx_discord_ban_records_guild_banned (guild_id, banned_at)
      )
    `);
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS discord_ban_panel_state (
        guild_id VARCHAR(40) NOT NULL PRIMARY KEY,
        channel_id VARCHAR(40) NOT NULL,
        message_id VARCHAR(40) NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    try {
      const [farmKeyColumns] = await dbPool.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'sowing_table_rows'
          AND COLUMN_NAME = 'farm_key'
      `);

      if (!farmKeyColumns.length) {
        await dbPool.query(
          "ALTER TABLE sowing_table_rows ADD COLUMN farm_key VARCHAR(20) NOT NULL DEFAULT 'farm2' FIRST"
        );
        await dbPool.query('ALTER TABLE sowing_table_rows DROP PRIMARY KEY');
        await dbPool.query(
          'ALTER TABLE sowing_table_rows ADD PRIMARY KEY (farm_key, field_value)'
        );
      }
    } catch (err) {
      console.log('SOWING TABLE SCHEMA MIGRATION ERROR:', err.message);
    }

    useMySql = true;
    const row = await readSharedBotConfigRow();

    if (row) {
      dbCache = mergeDbData(JSON.parse(row.config_value));
      sharedConfigUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : Date.now();
    } else {
      dbCache = readLocalDb();
      await persistDbCache();
    }

    const sqlFields = await readFarmingFieldsFromMySql();
    if (sqlFields) {
      dbCache.farmingFields = sqlFields;
      fs.writeFileSync(dbFile, JSON.stringify(dbCache, null, 2));
    } else {
      await persistFarmingFieldsToMySql(dbCache.farmingFields);
    }
    const sqlSowingTableRows = await readSowingTableRowsFromMySql();
    if (sqlSowingTableRows) {
      dbCache = mergeSowingTableRowsIntoData(dbCache, sqlSowingTableRows);
      fs.writeFileSync(dbFile, JSON.stringify(dbCache, null, 2));
    } else if (getTotalSowingTableRowCount(dbCache.sowingTables) > 0) {
      await persistSowingTableRowsToMySql(dbCache.sowingTables);
    }
    await migrateLegacyTicketBlacklist();

    const sqlDiscordBanRecords = await readDiscordBanRecordsFromMySql(guildId || '');
    if (Array.isArray(sqlDiscordBanRecords) && sqlDiscordBanRecords.length) {
      dbCache = mergeDbData({
        ...dbCache,
        discordBanRecords: sqlDiscordBanRecords,
      });
      fs.writeFileSync(dbFile, JSON.stringify(dbCache, null, 2));
    } else if (Array.isArray(dbCache.discordBanRecords) && dbCache.discordBanRecords.length) {
      await replaceDiscordBanRecordsForGuildInMySql(guildId || '', dbCache.discordBanRecords);
    }

    const sqlDiscordBanPanelState = await readDiscordBanPanelStateFromMySql(guildId || '');
    const nextDiscordBanPanelState = {
      channelId: DISCORD_BAN_PANEL_CHANNEL_ID,
      messageId: sqlDiscordBanPanelState?.messageId || dbCache.discordBanPanel?.messageId || null,
    };
    dbCache = mergeDbData({
      ...dbCache,
      discordBanPanel: nextDiscordBanPanelState,
    });
    fs.writeFileSync(dbFile, JSON.stringify(dbCache, null, 2));
    await saveDiscordBanPanelStateToMySql({
      guildId: guildId || '',
      ...nextDiscordBanPanelState,
    });
    await persistDbCache();

    setInterval(() => {
      refreshSharedBotConfigFromMySql(false).catch(() => {});
      readFarmingFieldsFromMySql()
        .then((fields) => {
          if (!fields) return;
          dbCache = mergeDbData({
            ...dbCache,
            farmingFields: fields,
          });
          fs.writeFileSync(dbFile, JSON.stringify(dbCache, null, 2));
        })
        .catch(() => {});
      readSowingTableRowsFromMySql()
        .then((rows) => {
          if (!rows) return;
          dbCache = mergeSowingTableRowsIntoData(dbCache, rows);
          fs.writeFileSync(dbFile, JSON.stringify(dbCache, null, 2));
        })
        .catch(() => {});
    }, 15000);
    console.log('Bot koristi zajednički MySQL storage.');
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

// Discord ban panel helperi
function canManageDiscordBans(member) {
  if (!member?.permissions) return false;
  return (
    member.permissions.has(PermissionFlagsBits.BanMembers) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function truncateText(value, maxLength) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeDiscordText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDiscordUserId(value) {
  const text = normalizeDiscordText(value);
  const mentionMatch = text.match(/\d{17,20}/);
  return mentionMatch ? mentionMatch[0] : '';
}

function getDiscordBanDisplayName(user, fallbackId = '') {
  if (!user) {
    return fallbackId ? `Nepoznat korisnik (${fallbackId})` : 'Nepoznat korisnik';
  }

  if (user.globalName && user.globalName !== user.username) {
    return `${user.globalName} (@${user.username})`;
  }

  if (user.username) {
    return `@${user.username}`;
  }

  return fallbackId ? `Nepoznat korisnik (${fallbackId})` : 'Nepoznat korisnik';
}

function getDiscordBanHandle(user, fallbackId = '') {
  const username = normalizeDiscordText(user?.username || '');
  if (username) return `@${username}`;
  return fallbackId ? `ID ${fallbackId}` : 'Nepoznat korisnik';
}

function getDiscordBanSubtitle(user) {
  const globalName = normalizeDiscordText(user?.globalName || '');
  const username = normalizeDiscordText(user?.username || '');

  if (globalName && username && globalName !== username) {
    return globalName;
  }

  return '';
}

function formatDiscordBanTimestamp(value, style = 'f') {
  const timestamp = new Date(value || 0).getTime();
  if (!timestamp) return 'Nepoznato';
  return `<t:${Math.floor(timestamp / 1000)}:${style}>`;
}

function getDiscordBanPageForUser(entries, userId, fallbackPage = 0) {
  const normalizedUserId = String(userId || '');
  const selectedIndex = entries.findIndex((entry) => entry.userId === normalizedUserId);
  if (selectedIndex === -1) return fallbackPage;
  return Math.floor(selectedIndex / DISCORD_BAN_PANEL_PAGE_SIZE);
}

function buildDiscordBanModal(page = 0) {
  const userInput = new TextInputBuilder()
    .setCustomId('ban_target_user')
    .setLabel('User ID ili mention')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('npr. 123456789012345678 ili <@123456789012345678>')
    .setRequired(true)
    .setMaxLength(40);

  const reasonInput = new TextInputBuilder()
    .setCustomId('ban_target_reason')
    .setLabel('Razlog bana')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Upisi razlog bana...')
    .setRequired(false)
    .setMaxLength(500);

  return new ModalBuilder()
    .setCustomId(`ban_panel_ban_modal:${page}`)
    .setTitle('Ban korisnika')
    .addComponents(
      new ActionRowBuilder().addComponents(userInput),
      new ActionRowBuilder().addComponents(reasonInput)
    );
}

function getDiscordBanPanelState() {
  const data = loadDb();
  return {
    channelId: DISCORD_BAN_PANEL_CHANNEL_ID,
    messageId:
      typeof data.discordBanPanel?.messageId === 'string' || data.discordBanPanel?.messageId === null
        ? data.discordBanPanel.messageId
        : null,
  };
}

function getStoredDiscordBanRecords(guildIdValue) {
  const normalizedGuildId = String(guildIdValue || guildId || '');
  const data = loadDb();
  const records = Array.isArray(data.discordBanRecords) ? data.discordBanRecords : [];

  return records
    .filter((record) => String(record.guildId || '') === normalizedGuildId)
    .map((record) => ({
      guildId: normalizedGuildId,
      userId: String(record.userId || ''),
      userTag: String(record.userTag || ''),
      reason: String(record.reason || '').trim(),
      bannedAt: record.bannedAt || null,
      executorId: record.executorId ? String(record.executorId) : '',
      executorTag: String(record.executorTag || ''),
    }))
    .filter((record) => record.userId);
}

async function upsertDiscordBanRecord(entry) {
  if (!entry?.userId) return null;

  const normalizedGuildId = String(entry.guildId || guildId || '');
  const normalizedUserId = String(entry.userId);
  const data = loadDb();
  const records = Array.isArray(data.discordBanRecords) ? data.discordBanRecords : [];
  const nextRecord = {
    guildId: normalizedGuildId,
    userId: normalizedUserId,
    userTag: String(entry.userTag || ''),
    reason: String(entry.reason || '').trim(),
    bannedAt:
      Object.prototype.hasOwnProperty.call(entry, 'bannedAt')
        ? entry.bannedAt
        : new Date().toISOString(),
    executorId: entry.executorId ? String(entry.executorId) : '',
    executorTag: String(entry.executorTag || ''),
  };
  const existingIndex = records.findIndex(
    (record) =>
      String(record.guildId || '') === normalizedGuildId &&
      String(record.userId || '') === normalizedUserId
  );

  if (existingIndex >= 0) {
    records[existingIndex] = {
      ...records[existingIndex],
      ...nextRecord,
    };
  } else {
    records.push(nextRecord);
  }

  data.discordBanRecords = records;
  saveDb(data);
  await upsertDiscordBanRecordToMySql(nextRecord);
  return nextRecord;
}

async function removeDiscordBanRecord(guildIdValue, userId) {
  const normalizedGuildId = String(guildIdValue || guildId || '');
  const normalizedUserId = String(userId || '');
  const data = loadDb();
  const records = Array.isArray(data.discordBanRecords) ? data.discordBanRecords : [];
  const nextRecords = records.filter(
    (record) =>
      !(
        String(record.guildId || '') === normalizedGuildId &&
        String(record.userId || '') === normalizedUserId
      )
  );

  if (nextRecords.length === records.length) {
    return removeDiscordBanRecordFromMySql(normalizedGuildId, normalizedUserId);
  }

  data.discordBanRecords = nextRecords;
  saveDb(data);
  await removeDiscordBanRecordFromMySql(normalizedGuildId, normalizedUserId);
  return true;
}

async function syncDiscordBanRecordsFromLiveBans(guild, liveBanCollection = null) {
  if (!guild) return [];

  const banCollection = liveBanCollection || (await guild.bans.fetch().catch(() => null));
  if (!banCollection) return [];

  const currentBans = Array.from(banCollection.values());
  const activeUserIds = new Set(currentBans.map((ban) => String(ban.user.id)));
  const data = loadDb();
  const allRecords = Array.isArray(data.discordBanRecords) ? data.discordBanRecords : [];
  const guildRecords = allRecords.filter((record) => String(record.guildId || '') === String(guild.id));
  const otherRecords = allRecords.filter((record) => String(record.guildId || '') !== String(guild.id));
  const mergedByUserId = new Map(
    guildRecords
      .filter((record) => record?.userId)
      .map((record) => [String(record.userId), { ...record }])
  );

  for (const ban of currentBans) {
    const userId = String(ban.user.id);
    const existing = mergedByUserId.get(userId);

    mergedByUserId.set(userId, {
      guildId: guild.id,
      userId,
      userTag: existing?.userTag || getDiscordBanDisplayName(ban.user, userId),
      reason: existing?.reason || String(ban.reason || '').trim(),
      bannedAt:
        Object.prototype.hasOwnProperty.call(existing || {}, 'bannedAt')
          ? existing.bannedAt
          : null,
      executorId: existing?.executorId || '',
      executorTag: existing?.executorTag || '',
    });
  }

  const nextGuildRecords = Array.from(mergedByUserId.values()).filter((record) =>
    activeUserIds.has(String(record.userId || ''))
  );

  data.discordBanRecords = [...otherRecords, ...nextGuildRecords];
  saveDb(data);
  await replaceDiscordBanRecordsForGuildInMySql(guild.id, nextGuildRecords);
  return nextGuildRecords;
}

async function fetchMatchingBanAuditEntry(guild, userId) {
  if (!guild || !userId) return null;

  const auditLogs = await guild
    .fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 6 })
    .catch(() => null);
  const entries = auditLogs ? Array.from(auditLogs.entries.values()) : [];
  const now = Date.now();

  return (
    entries.find((entry) => {
      if (String(entry.target?.id || '') !== String(userId)) return false;
      return Math.abs(now - entry.createdTimestamp) <= 5 * 60 * 1000;
    }) || null
  );
}

async function getDiscordBanEntries(guild) {
  if (!guild) return [];

  const banCollection = await guild.bans.fetch().catch(() => null);
  if (!banCollection) return [];

  const storedRecords = getStoredDiscordBanRecords(guild.id);
  const storedByUserId = new Map(storedRecords.map((record) => [record.userId, record]));

  return Array.from(banCollection.values())
    .map((ban) => {
      const stored = storedByUserId.get(String(ban.user.id));
      return {
        userId: String(ban.user.id),
        user: ban.user,
        displayName: getDiscordBanDisplayName(ban.user, ban.user.id),
        reason: String(ban.reason || stored?.reason || '').trim(),
        bannedAt: stored?.bannedAt || null,
        executorId: stored?.executorId || '',
        executorTag: stored?.executorTag || '',
      };
    })
    .sort((left, right) => {
      const rightTime = new Date(right.bannedAt || 0).getTime();
      const leftTime = new Date(left.bannedAt || 0).getTime();

      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      return left.displayName.localeCompare(right.displayName, 'hr');
    });
}

function buildDiscordBanPanelEmbed(guild, entries, page, selectedUserId) {
  const totalPages = Math.max(1, Math.ceil(entries.length / DISCORD_BAN_PANEL_PAGE_SIZE));
  const safePage = clampNumber(page, 0, totalPages - 1);
  const startIndex = safePage * DISCORD_BAN_PANEL_PAGE_SIZE;
  const pageEntries = entries.slice(startIndex, startIndex + DISCORD_BAN_PANEL_PAGE_SIZE);
  const selectedIndex = entries.findIndex((entry) => entry.userId === selectedUserId);
  const selectedEntry =
    selectedIndex >= 0
      ? entries[selectedIndex]
      : pageEntries.length
        ? pageEntries[0]
        : null;
  const menuPage =
    selectedIndex >= 0
      ? Math.floor(selectedIndex / DISCORD_BAN_PANEL_MENU_PAGE_SIZE)
      : Math.floor(startIndex / DISCORD_BAN_PANEL_MENU_PAGE_SIZE);
  const menuStartIndex = menuPage * DISCORD_BAN_PANEL_MENU_PAGE_SIZE;
  const menuEntries = entries.slice(
    menuStartIndex,
    menuStartIndex + DISCORD_BAN_PANEL_MENU_PAGE_SIZE
  );
  const listRangeLabel = pageEntries.length
    ? `${startIndex + 1}-${startIndex + pageEntries.length}`
    : '0-0';

  const listValue = pageEntries.length
    ? pageEntries
        .map((entry, index) => {
          const listLabel = truncateText(getDiscordBanHandle(entry.user, entry.userId), 32);
          const subtitle = getDiscordBanSubtitle(entry.user);
          return [
            `**${String(startIndex + index + 1).padStart(2, '0')}. ${listLabel}**`,
            subtitle ? `${truncateText(subtitle, 40)}` : null,
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n')
    : '_Trenutno nema banovanih clanova._';

  const detailHandle = selectedEntry
    ? getDiscordBanHandle(selectedEntry.user, selectedEntry.userId)
    : 'Nema odabira';
  const detailSubtitle = selectedEntry ? getDiscordBanSubtitle(selectedEntry.user) : '';
  const detailModerator = selectedEntry
    ? selectedEntry.executorId
      ? `<@${selectedEntry.executorId}>`
      : truncateText(selectedEntry.executorTag || 'Nepoznato', 60)
    : 'Nepoznato';
  const detailReason = selectedEntry
    ? truncateText(normalizeDiscordText(selectedEntry.reason || 'Nema unesenog razloga.'), 420)
    : 'Odaberi korisnika iz dropdowna ispod kako bi se prikazali detalji bana.';

  const descriptionParts = [
    '```',
    ' Upravljaj Discord banovima iz ovog panela',
    '```',
    '',
    '**Sto mozes u panelu?**',
    '',
    `📋 **Ban Lista** - pregled ${pageEntries.length} korisnika na ovoj stranici`,
    `📑 **Dropdown** - listanje svih banovanih i razlog po korisniku`,
    `⛔ **Ban** - dodavanje novog bana direktno iz poruke`,
    `✅ **Unban** - skidanje bana za odabranog korisnika`,
    `🕒 **Live Sync** - automatski refresh nakon restarta, bana i unbana`,
    '',
    '────────────────────',
    '',
    `**Ban Lista (${listRangeLabel})**`,
    '',
    listValue,
    '',
    '────────────────────',
    '',
    '**Detalji Odabranog Bana**',
    '',
    `👤 **Korisnik:** ${detailHandle}`,
    detailSubtitle ? `🪪 **Prikazno ime:** ${truncateText(detailSubtitle, 60)}` : null,
    selectedEntry ? `🆔 **ID:** \`${selectedEntry.userId}\`` : null,
    selectedEntry ? `📅 **Ban od:** ${formatDiscordBanTimestamp(selectedEntry.bannedAt, 'f')}` : null,
    selectedEntry ? `⏱️ **Proslo:** ${formatDiscordBanTimestamp(selectedEntry.bannedAt, 'R')}` : null,
    selectedEntry ? `🛡️ **Moderator:** ${detailModerator}` : null,
    `📝 **Razlog:** ${detailReason}`,
  ].filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor('#5865f2')
    .setTitle('📊 Discord Ban Dashboard')
    .setDescription(descriptionParts.join('\n'))
    .setFooter({
      text: `Discord Ban Dashboard • ${guild?.name || 'Discord Server'} • Stranica ${safePage + 1}/${totalPages} • Ukupno ${entries.length}`,
      iconURL: guild?.iconURL?.({ size: 128 }) || undefined,
    })
    .setTimestamp();

  return {
    embed,
    pageEntries,
    menuEntries,
    menuPage,
    safePage,
    selectedUserId: selectedEntry?.userId || '',
    totalPages,
  };
}

function buildDiscordBanPanelComponents(guild, entries, page, selectedUserId) {
  const state = buildDiscordBanPanelEmbed(guild, entries, page, selectedUserId);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ban_panel:prev:${state.safePage}:${state.selectedUserId || 'none'}`)
      .setLabel('Nazad')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.safePage <= 0 || !entries.length),
    new ButtonBuilder()
      .setCustomId(`ban_panel:next:${state.safePage}:${state.selectedUserId || 'none'}`)
      .setLabel('Naprijed')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.safePage >= state.totalPages - 1 || !entries.length),
    new ButtonBuilder()
      .setCustomId(`ban_panel:ban:${state.safePage}:${state.selectedUserId || 'none'}`)
      .setLabel('Ban')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ban_panel:unban:${state.safePage}:${state.selectedUserId || 'none'}`)
      .setLabel('Unban')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!state.selectedUserId)
  );
  const components = [row];

  if (state.menuEntries.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`ban_panel_select:${state.safePage}:${state.menuPage}`)
      .setPlaceholder('Odaberi korisnika za detalje i unban')
      .addOptions(
        state.menuEntries.map((entry) => ({
          label: truncateText(getDiscordBanHandle(entry.user, entry.userId), 100),
          description: truncateText(
            normalizeDiscordText(entry.reason || 'Bez upisanog razloga'),
            100
          ),
          value: entry.userId,
          default: entry.userId === state.selectedUserId,
        }))
      );

    components.push(new ActionRowBuilder().addComponents(menu));
  }

  return {
    embeds: [state.embed],
    components,
    selectedUserId: state.selectedUserId,
    safePage: state.safePage,
  };
}

async function createDiscordBanPanelPayload(guild, options = {}) {
  const entries = await getDiscordBanEntries(guild);
  const requestedPage = Number.isFinite(options.page)
    ? options.page
    : options.selectedUserId
      ? getDiscordBanPageForUser(entries, options.selectedUserId, 0)
      : 0;
  return buildDiscordBanPanelComponents(
    guild,
    entries,
    requestedPage,
    options.selectedUserId ? String(options.selectedUserId) : ''
  );
}

async function updateDiscordBanPanel(guild, options = {}) {
  if (!guild) return null;

  const storedState = getDiscordBanPanelState();
  const nextChannelId = DISCORD_BAN_PANEL_CHANNEL_ID;
  if (!nextChannelId) return null;

  const channel = await guild.channels.fetch(nextChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;

  await syncDiscordBanRecordsFromLiveBans(guild);
  const payload = await createDiscordBanPanelPayload(guild, options);
  const data = loadDb();
  let message = null;

  if (storedState.messageId) {
    message = await channel.messages.fetch(storedState.messageId).catch(() => null);
  }

  if (!message) {
    const recentMessages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (recentMessages?.size) {
      const matchingMessages = Array.from(recentMessages.values())
        .filter(
          (entry) =>
            entry.author?.id === client.user?.id &&
            entry.embeds?.[0]?.title === DISCORD_BAN_PANEL_TITLE
        )
        .sort((left, right) => right.createdTimestamp - left.createdTimestamp);

      if (matchingMessages.length) {
        const [primaryMessage, ...duplicates] = matchingMessages;
        message = primaryMessage;
        for (const duplicate of duplicates) {
          await duplicate.delete().catch(() => {});
        }
      }
    }
  }

  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
  }

  data.discordBanPanel = {
    channelId: channel.id,
    messageId: message.id,
  };
  saveDb(data);
  await saveDiscordBanPanelStateToMySql({
    guildId: guild.id,
    channelId: channel.id,
    messageId: message.id,
  });
  return message;
}

// helper: vraca ticket config = default + ono sto je u db.json
function getTicketConfig() {
  const data = loadDb();
  const cfg = data.ticketSystem || {};

  const merged = {
    // ako u configu nema ID, koristi hard-coded konstante niže (TICKET_CATEGORY_ID / TICKET_LOG_CHANNEL_ID)
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

function sortFarmingFieldLabels(list) {
  const collator = new Intl.Collator('hr', {
    numeric: true,
    sensitivity: 'base',
  });

  return [...list].sort((a, b) => collator.compare(a, b));
}

function sortSowingTableRows(rows) {
  const collator = new Intl.Collator('hr', {
    numeric: true,
    sensitivity: 'base',
  });

  return [...rows].sort((a, b) => collator.compare(a.field, b.field));
}

function normalizeSowingTableRows(rows) {
  const seen = new Set();
  const normalized = [];

  for (const rawRow of Array.isArray(rows) ? rows : []) {
    const field = String(rawRow?.field || '').trim();
    if (!field) continue;

    const key = field.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      field,
      year1: String(rawRow?.year1 || '').trim(),
      year2: String(rawRow?.year2 || '').trim(),
      year3: String(rawRow?.year3 || '').trim(),
      year4: String(rawRow?.year4 || '').trim(),
    });
  }

  return sortSowingTableRows(normalized);
}

function normalizeSowingTable(rawTable) {
  const data = rawTable && typeof rawTable === 'object' ? rawTable : {};
  const sourceLabels = Array.isArray(data.yearLabels) ? data.yearLabels : [];
  const labels = DEFAULT_SOWING_TABLE.yearLabels.map((fallback, index) =>
    String(sourceLabels[index] || fallback).trim() || fallback
  );

  return {
    channelId: String(data.channelId || '').trim(),
    messageId: data.messageId ? String(data.messageId) : null,
    yearLabels: labels,
    rows: normalizeSowingTableRows(data.rows),
  };
}

function normalizeSowingTables(rawTables) {
  const base = JSON.parse(JSON.stringify(DEFAULT_SOWING_TABLES));

  if (!rawTables || typeof rawTables !== 'object' || Array.isArray(rawTables)) {
    // Backward compatibility: old single table becomes Farma 2 table.
    return buildFarmState((farmKey) =>
      normalizeSowingTable({
        ...(base[farmKey] || buildDefaultSowingTable()),
        ...(farmKey === 'farm2' && rawTables && typeof rawTables === 'object' ? rawTables : {}),
      })
    );
  }

  const hasFarmEntries = KNOWN_FARM_KEYS.some((farmKey) => rawTables[farmKey]);

  return buildFarmState((farmKey) =>
    normalizeSowingTable({
      ...(base[farmKey] || buildDefaultSowingTable()),
      ...(rawTables[farmKey] || {}),
      ...(!hasFarmEntries && farmKey === 'farm2' ? rawTables : {}),
    })
  );
}

function normalizeFarmingFields(rawFields) {
  const uniqueStrings = (list) =>
    sortFarmingFieldLabels(Array.from(new Set((list || []).map(String))));

  if (Array.isArray(rawFields)) {
    return buildFarmState((farmKey) =>
      farmKey === 'farm1'
        ? uniqueStrings(rawFields.length ? rawFields : DEFAULT_FARMING_FIELDS)
        : []
    );
  }

  if (rawFields && typeof rawFields === 'object') {
    return buildFarmState((farmKey) =>
      uniqueStrings(
        Object.prototype.hasOwnProperty.call(rawFields, farmKey)
          ? rawFields[farmKey]
          : farmKey === 'farm1'
            ? DEFAULT_FARMING_FIELDS
            : []
      )
    );
  }

  return buildDefaultFarmingFields();
}

function getTotalSowingTableRowCount(tables) {
  const normalizedTables = normalizeSowingTables(tables);
  return KNOWN_FARM_KEYS.reduce(
    (sum, farmKey) => sum + (normalizedTables[farmKey]?.rows?.length || 0),
    0
  );
}

function mergeSowingTableRowsIntoData(baseData, rowsByFarm) {
  const nextTables = normalizeSowingTables(baseData.sowingTables || baseData.sowingTable);

  for (const farmKey of KNOWN_FARM_KEYS) {
    nextTables[farmKey] = normalizeSowingTable({
      ...(nextTables[farmKey] || DEFAULT_SOWING_TABLES[farmKey] || DEFAULT_SOWING_TABLE),
      rows: rowsByFarm[farmKey] || [],
    });
  }

  return mergeDbData({
    ...baseData,
    sowingTables: nextTables,
  });
}

// helper: vraća listu polja za Farming zadatke
function getFarmingFields(farmKey = 'farm1') {
  const data = loadDb();
  const normalized = normalizeFarmingFields(data.farmingFields);
  const fields = normalized[farmKey];
  if (Array.isArray(fields)) return fields.map(String);
  return [];
}

function getAllFarmingFields() {
  const data = loadDb();
  return normalizeFarmingFields(data.farmingFields);
}

function buildTaskFieldSelectionRows(fields, farmKey) {
  const rows = [];

  for (let i = 0; i < fields.length && rows.length < 5; i += 25) {
    const slice = fields.slice(i, i + 25);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`task_field_select_${farmKey}_${rows.length + 1}`)
      .setPlaceholder(`Odaberi polje (${i + 1}-${i + slice.length})`)
      .addOptions(
        slice.map((field) => ({
          label: `Polje ${field}`,
          value: String(field),
        }))
      );

    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  return rows;
}

function getTaskPriorities() {
  return {
    hitno: { label: '🔴 HITNO', value: 4, color: '#ff0000' },
    visok: { label: '🟠 Visok', value: 3, color: '#ffa500' },
    srednji: { label: '🟡 Srednji', value: 2, color: '#ffd000' },
    nizak: { label: '🟢 Nizak', value: 1, color: '#3ba55d' },
  };
}

function scheduleInteractionReplyDeletion(interaction, delayMs = 2000) {
  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, delayMs);
}

async function cleanupTransientTaskMessage(interaction, current) {
  const messageId = current?.transientMessageId;
  if (!messageId || !interaction.channel) return;

  await interaction.channel.messages.delete(messageId).catch(() => {});
}

// helper: spremi polja u db.json
function saveFarmingFields(farmKey, fields) {
  const data = loadDb();
  const normalized = normalizeFarmingFields(data.farmingFields);
  normalized[farmKey] = Array.from(new Set(fields.map(String)));
  data.farmingFields = normalized;
  saveDb(data);
  persistFarmingFieldsToMySql(normalized).catch((err) => {
    console.log('FARMING FIELDS SAVE ERROR:', err.message);
  });
}

function buildFarmingFieldPanelEmbed() {
  const allFields = getAllFarmingFields();
  const farm1Fields = allFields.farm1 || [];
  const farm2Fields = allFields.farm2 || [];
  const farm3Fields = allFields.farm3 || [];
  const emptyValue = '\u200B';

  const embed = new EmbedBuilder()
    .setColor('#3ba55d')
    .setTitle('🧑‍🌾 Upravljanje poljima')
    .setDescription(
      'Ovdje možeš dodavati i uređivati polja za sve farme.\n\n' +
      'Prvo odaberi radnju, a zatim će bot pitati za koju farmu radiš promjenu.'
    )
    .addFields(
      {
        name: 'Farma 1',
        value: farm1Fields.length ? farm1Fields.map((field) => `- ${field}`).join('\n') : emptyValue,
        inline: true,
      },
      {
        name: 'Farma 2',
        value: farm2Fields.length ? farm2Fields.map((field) => `- ${field}`).join('\n') : emptyValue,
        inline: true,
      },
      {
        name: 'Farma 3',
        value: farm3Fields.length ? farm3Fields.map((field) => `- ${field}`).join('\n') : emptyValue,
        inline: true,
      }
    )
    .setTimestamp();

  return embed;
}

function buildFarmingFieldPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('field_action_add')
      .setLabel('➕ Dodaj polje')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('field_action_update')
      .setLabel('✏️ Uredi polje')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('field_action_remove')
      .setLabel('🗑️ Obriši polje')
      .setStyle(ButtonStyle.Danger)
  );
}

async function updateFarmingFieldsEmbed(guild) {
  if (!guild) return;

  const channel = await guild.channels.fetch(FARM_FIELD_PANEL_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const data = loadDb();
  const embed = buildFarmingFieldPanelEmbed();
  const row = buildFarmingFieldPanelRow();

  if (data.farmingFieldListMessageId) {
    const existingMessage = await channel.messages
      .fetch(data.farmingFieldListMessageId)
      .catch(() => null);

    if (existingMessage) {
      await existingMessage.edit({ embeds: [embed], components: [row] });
      return;
    }
  }

  const recentMessages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (recentMessages?.size) {
    const matchingMessages = Array.from(recentMessages.values())
      .filter(
        (message) =>
          message.author?.id === client.user?.id &&
          message.embeds?.[0]?.title === '🧑‍🌾 Upravljanje poljima'
      )
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    if (matchingMessages.length) {
      const [primaryMessage, ...duplicates] = matchingMessages;
      await primaryMessage.edit({ embeds: [embed], components: [row] });

      for (const duplicate of duplicates) {
        await duplicate.delete().catch(() => {});
      }

      data.farmingFieldListMessageId = primaryMessage.id;
      saveDb(data);
      return;
    }
  }

  const sent = await channel.send({ embeds: [embed], components: [row] });
  data.farmingFieldListMessageId = sent.id;
  saveDb(data);
}

function getSowingTableState(farmKey) {
  const data = loadDb();
  const tables = normalizeSowingTables(data.sowingTables || data.sowingTable);
  return normalizeSowingTable(tables[farmKey] || DEFAULT_SOWING_TABLES[farmKey] || DEFAULT_SOWING_TABLE);
}

function saveSowingTableState(farmKey, nextState) {
  const data = loadDb();
  const tables = normalizeSowingTables(data.sowingTables || data.sowingTable);
  tables[farmKey] = normalizeSowingTable({
    ...(DEFAULT_SOWING_TABLES[farmKey] || DEFAULT_SOWING_TABLE),
    ...nextState,
  });
  data.sowingTables = tables;
  delete data.sowingTable;
  saveDb(data);
  persistSowingTableRowsToMySql(tables).catch((err) => {
    console.log('SOWING TABLE SAVE ERROR:', err.message);
  });
}

function resolveSowingTableFarmKey(channelId) {
  return (
    Object.entries(SOWING_TABLE_CHANNEL_IDS).find(([, id]) => id === channelId)?.[0] || null
  );
}

function buildSowingTableControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('sowing_table_add')
      .setLabel('Dodaj red')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('sowing_table_edit')
      .setLabel('Uredi polje')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('sowing_table_years')
      .setLabel('Promijeni godinu')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('sowing_table_delete')
      .setLabel('Obriši red')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('sowing_table_refresh')
      .setLabel('Osvježi')
      .setStyle(ButtonStyle.Secondary)
  );
}

function drawTableCellText(ctx, value, x, y, width, height, options = {}) {
  const text = String(value || '').trim();
  const paddingX = options.paddingX ?? 14;
  const baselineY = y + height / 2 + 9;
  const maxWidth = width - paddingX * 2;

  ctx.fillStyle = options.color || '#ffffff';
  ctx.font = options.font || `26px "${LOCAL_SOWING_TABLE_FONT_FAMILY}"`;
  ctx.textAlign = options.align || 'left';
  ctx.textBaseline = 'middle';

  let output = text;
  while (output && ctx.measureText(output).width > maxWidth) {
    output = `${output.slice(0, -2)}…`;
  }

  const drawX = options.align === 'center' ? x + width / 2 : x + paddingX;
  ctx.fillText(output, drawX, baselineY);
}

function buildSowingTableImageBuffer(tableState) {
  const columns = [
    { key: 'field', label: 'POLJE', width: 320 },
    { key: 'year1', label: tableState.yearLabels[0], width: 320 },
    { key: 'year2', label: tableState.yearLabels[1], width: 320 },
    { key: 'year3', label: tableState.yearLabels[2], width: 320 },
    { key: 'year4', label: tableState.yearLabels[3], width: 320 },
  ];
  const rowHeight = 58;
  const headerHeight = 64;
  const tableRows = tableState.rows.length
    ? tableState.rows
    : [{ field: '—', year1: 'Nema podataka', year2: '', year3: '', year4: '' }];
  const canvasWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const canvasHeight = headerHeight + tableRows.length * rowHeight + 2;
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#202225';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.strokeStyle = '#8f8f8f';
  ctx.lineWidth = 1;

  let currentX = 0;
  for (const column of columns) {
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(currentX, 0, column.width, headerHeight);
    ctx.strokeRect(currentX, 0, column.width, headerHeight);
    drawTableCellText(ctx, column.label, currentX, 0, column.width, headerHeight, {
      font: `bold 28px "${LOCAL_SOWING_TABLE_FONT_FAMILY}"`,
    });
    currentX += column.width;
  }

  tableRows.forEach((row, rowIndex) => {
    let x = 0;
    const y = headerHeight + rowIndex * rowHeight;

    columns.forEach((column) => {
      ctx.fillStyle = rowIndex % 2 === 0 ? '#25272b' : '#2c2f33';
      ctx.fillRect(x, y, column.width, rowHeight);
      ctx.strokeRect(x, y, column.width, rowHeight);
      drawTableCellText(ctx, row[column.key], x, y, column.width, rowHeight);
      x += column.width;
    });
  });

  return canvas.toBuffer('image/png');
}

function buildSowingTableMessageContent(tableState, farmKey) {
  const farm = getFarmConfig(farmKey);
  return [
    `📋 **Tablica Sjetve - ${farm.label}**`,
    'Pregled i uređivanje sjetvenog plana direktno iz Discorda.',
    `Ukupno redova: **${tableState.rows.length}**`,
  ].join('\n');
}

async function updateSowingTableMessage(guild, farmKey) {
  if (!guild) return null;

  const tableState = getSowingTableState(farmKey);
  if (!tableState.channelId) return null;

  const channel = await guild.channels.fetch(tableState.channelId).catch(() => null);
  if (!channel) return null;

  const content = buildSowingTableMessageContent(tableState, farmKey);
  const controls = buildSowingTableControlRow();
  const attachment = new AttachmentBuilder(buildSowingTableImageBuffer(tableState), {
    name: 'sowing-table.png',
  });
  const data = loadDb();
  const nextTables = normalizeSowingTables(data.sowingTables || data.sowingTable);
  const nextState = normalizeSowingTable(nextTables[farmKey] || tableState);

  let message = null;
  if (tableState.messageId) {
    message = await channel.messages.fetch(tableState.messageId).catch(() => null);
  }

  if (!message) {
    const recentMessages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (recentMessages?.size) {
      const matches = Array.from(recentMessages.values())
        .filter(
          (msg) =>
            msg.author?.id === client.user?.id &&
            typeof msg.content === 'string' &&
            msg.content.startsWith(`📋 **Tablica Sjetve - ${getFarmConfig(farmKey).label}**`)
        )
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

      if (matches.length) {
        const [primary, ...duplicates] = matches;
        message = primary;
        for (const duplicate of duplicates) {
          await duplicate.delete().catch(() => {});
        }
      }
    }
  }

  if (message) {
    await message.edit({
      content,
      embeds: [],
      components: [controls],
      files: [attachment],
    });
  } else {
    message = await channel.send({
      content,
      components: [controls],
      files: [attachment],
    });
  }

  nextState.channelId = channel.id;
  nextState.messageId = message.id;
  saveSowingTableState(farmKey, nextState);
  return message;
}

// =====================
//  SOWING SEASON SYSTEM – DB + HELPERS
// =====================

// ID kanala gdje ide živa embed poruka
const SOWING_SEASON_CHANNEL_ID = "1437698436068671528";

// učitaj ili kreiraj listu sezona
function getSowingSeasons() {
  const data = loadDb();

  if (!Array.isArray(data.sowingSeasons)) {
    data.sowingSeasons = [];
    saveDb(data); // ← ključna linija
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
    fields: {}, // "36": "ječam"
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
  return "▰".repeat(filledCount) + "▱".repeat(emptyCount) + ` ${percent}%`;
}

// update ili kreiranje embed poruke u sezoni
async function updateSeasonEmbed(guild, forceEmpty = false) {
  const season = getActiveSeason();
  const allFields = getAllFarmingFields();
  const fields = Array.from(new Set([...(allFields.farm1 || []), ...(allFields.farm2 || [])]));
  const total = fields.length;
  const sownCount = Object.keys(season.fields).length;

  const channel = await guild.channels
    .fetch(SOWING_SEASON_CHANNEL_ID)
    .catch(() => null);

  if (!channel) return;

  // -------------------------------------------------------
  // 1️⃣ FORCE RESET MODE → prazan embed bez polja
  // -------------------------------------------------------
  if (forceEmpty === true) {
    const emptyEmbed = new EmbedBuilder()
      .setColor("#3ba55d")
      .setTitle(`🌾 Sezona Sjetve #${season.season}`)
      .setDescription("_Još nema posijanih polja..._")
      .addFields({
        name: "Progres",
        value: `0/${total}\n${makeSeasonProgressBar(0, total)}`
      })
      .setTimestamp();

    // Ako embed postoji, osvježi ga
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
  // 2️⃣ NORMALNI MODE → prikaz samo posijanih polja
  // -------------------------------------------------------
  const lines = [];

  for (const f of fields) {
    if (season.fields[f]) {
      lines.push(`**Polje ${f}** – ${season.fields[f]}`);
    }
  }


  if (lines.length === 0) {
    lines.push("_Još nema posijanih polja..._");
  }


  const progress = makeSeasonProgressBar(sownCount, total);

  const embed = new EmbedBuilder()
    .setColor("#3ba55d")
    .setTitle(`🌾 Sezona Sjetve #${season.season}`)
    .setDescription(lines.join("\n"))
    .addFields({
      name: "Progres",
      value: `${sownCount}/${total}\n${progress}`,
    })
    .setTimestamp();

  // Ako embed još ne postoji – kreiraj ga
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

  // Inače — osvježi embed
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

  // Završetak sezone
  if (sownCount >= total && !season.completed) {
    season.completed = true;
    saveSowingSeasons(getSowingSeasons());

    const doneEmbed = EmbedBuilder.from(embed)
      .setColor("#ffcc00")
      .setTitle(`🌾 Sezona Sjetve #${season.season} — ✔ Završena`);

    await msg.edit({ embeds: [doneEmbed] });


    createNewSeason();
  }
}

// =====================
//  SOWING – Upis polja u sezonu
// =====================
async function handleNewSowingTask(guild, field, cropName) {
    const seasons = getSowingSeasons();
    let season = getActiveSeason();

    // pronađi pravi season objekt
    const idx = seasons.findIndex(s => s.season === season.season);
    if (idx === -1) {
        console.log("⚠️ Sezona nije pronađena u listi!");
        return;
    }

    // upis kulture
    seasons[idx].fields[field] = cropName;

    // spremi u db.json
    saveSowingSeasons(seasons);

    console.log(`🌱 Upis sjetve → Sezona ${season.season}, Polje ${field}: ${cropName}`);

    // osvježavanje embeda
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

// 🧮 helper za lijepi uptime
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
    console.log('❌ Ne mogu fetchati guild:', guildId, e.message);
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
        name: 'Guild nije učitan',
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
      console.log('❌ Greška pri fetchanju kanala:', e.message);
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
      : 'Dobrodošao {user} na server!';
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
    res.status(500).send('Greška pri slanju embed-a: ' + err.message);
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
//  FS WEBHOOK – helper za provjeru secreta
// =====================
function checkFsSecret(req, res) {
  const sent =
    req.headers['x-fs-secret'] ||
    req.headers['x-fs25-secret'] ||
    (req.body && req.body.secret);

  if (!FS_WEBHOOK_SECRET) {
    console.warn('⚠️ FS_WEBHOOK_SECRET nije postavljen u .env – odbijam zahtjev.');
    res.status(500).json({ ok: false, error: 'secret_not_configured' });
    return false;
  }

  if (!sent) {
    console.warn('⚠️ FS webhook: secret nije poslan u headeru/body-u.');
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }

  if (sent !== FS_WEBHOOK_SECRET) {
    console.warn(
      '⚠️ FS webhook: neispravan secret. serverLen=%d, sentLen=%d',
      FS_WEBHOOK_SECRET.length,
      String(sent).length
    );
    res.status(403).json({ ok: false, error: 'invalid_secret' });
    return false;
  }

  return true;
}


// =====================
//  FS TELEMETRY – helper funkcije (emoji, progress bar, boje, embed)
// =====================

function makeProgressBar(percent, size = 10) {
  const p = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const filled = Math.round((p / 100) * size);
  const empty = size - filled;
  const fullChar = '█';
  const emptyChar = '░';
  return fullChar.repeat(filled) + emptyChar.repeat(empty);
}

function pickVehicleEmoji(typeName = '') {
  const t = typeName.toLowerCase();
  if (t.includes('combine')) return '🌾';
  if (t.includes('truck') || t.includes('lkw')) return '🚚';
  if (t.includes('trailer')) return '🚛';
  if (t.includes('car') || t.includes('pickup')) return '🚙';
  if (t.includes('telehandler') || t.includes('loader')) return '🚧';
  return '🚜';
}

function pickColorFromVehicle(v) {
  if (!v) return 0x2f3136;
  const dmg = v.damage?.damagePercent ?? 0;
  const broken = v.damage?.isBroken;

  if (broken || dmg >= 80) return 0xff0000;      // crveno – razbijen
  if (dmg >= 40) return 0xffa500;                // narančasto – dosta oštećen
  if (v.isOnAI) return 0xffe000;                 // žuto – AI ga vozi
  if (v.isRunning) return 0x57f287;              // zeleno – motor radi
  return 0x5865f2;                               // default Discord plava
}

function createTelemetryEmbed(telemetry) {
  const v = telemetry?.vehicles?.[0];

  if (!v) {
    return new EmbedBuilder()
      .setTitle('FS25 TELEMETRY')
      .setDescription('Nije pronađen nijedan aktivni stroj u telemetriji.')
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

  // fill info – uzimamo prvi spremnik ako postoji
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
  const controlledText = v.isControlled ? 'Igrač' : (v.isOnAI ? 'AI' : 'Nije');

  const playerName = v.playerName || 'Nepoznat';
  const farmName = v.farmName || `Farm ${v.farmId ?? '?'}`;

  // 🔹 PRVA LINIJA – sve u jednom redu:
  // "CLAAS TRION 750 | 8 km/h | F112 | 54% Corn"
  const summaryLine =
    `${emoji} ${v.vehicleName || 'Vozilo'} | ` +
    `${speed} | ` +
    `${fieldText} | ` +
    `📦 ${fillLine}`;

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
          `**Igrač:** ${playerName}`,
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
        name: 'Gorivo 🛢️',
        value: [
          `**${fuelType}:** ${fuelPercent}%`,
          fuelBar,
          defBar != null ? `**DEF:** ${defPercent}%\n${defBar}` : null,
        ].filter(Boolean).join('\n'),
        inline: true,
      },
      {
        name: 'Šteta',
        value: [
          `**Stanje:** ${damagePercent}%`,
          damageBar,
          v.damage?.isBroken ? '⚠️ **Vozilo je pokvareno!**' : '',
        ].filter(Boolean).join('\n'),
        inline: true,
      },
      {
        name: 'Spremnici 📦',
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
        name: 'Pozicija 🧭',
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
      text: `${telemetry.modName || 'FS25_DiscordBridge'} • ${new Date().toLocaleString('hr-HR')}`,
    });

  return embed;
}

// =====================
//  FS WEBHOOK – test ruta
// =====================
app.post('/fs/test', (req, res) => {
  if (!checkFsSecret(req, res)) return;

  console.log('🔗 [FS TEST] Primljen payload:', req.body);

  res.json({ ok: true, received: req.body });
});

// =====================
//  FS WEBHOOK – TELEMETRY -> DISCORD EMBED
// =====================
app.post('/fs/telemetry', async (req, res) => {
  if (!checkFsSecret(req, res)) return;

  const body = req.body || {};
  const telemetry = body.telemetry || body;

  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      console.warn('⚠️ /fs/telemetry: guild nije učitan.');
      return res.status(500).json({ ok: false, error: 'guild_not_loaded' });
    }

    const channel = await client.channels
      .fetch(FS_TELEMETRY_CHANNEL_ID)
      .catch(() => null);

    if (!channel) {
      console.warn('⚠️ /fs/telemetry: kanal za telemetriju nije podešen.');
      return res
        .status(500)
        .json({ ok: false, error: 'telemetry_channel_not_configured' });
    }

    const vehicles = Array.isArray(telemetry.vehicles)
      ? telemetry.vehicles
      : [];

    // Ako nema vozila – simple embed
    if (vehicles.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x2f3136)
        .setTitle('FS25 TELEMETRY')
        .setDescription('Nije pronađen nijedan aktivni stroj u telemetriji.')
        .setTimestamp(new Date());

      await channel.send({ embeds: [embed] });
      return res.json({ ok: true, sent: true, vehicles: 0 });
    }

    // Inače koristimo naš fancy helper s emoji + progress barovima
    const embed = createTelemetryEmbed(telemetry);
    await channel.send({ embeds: [embed] });

    return res.json({
      ok: true,
      sent: true,
      vehicles: vehicles.length,
    });
  } catch (err) {
    console.error('❌ Greška u /fs/telemetry:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});




// =====================
//  FS – pomoćne funkcije za zadatke (DB)
// =====================

// spremi / update jednog zadatka u db.json
function saveFarmingTask(record) {
  const data = loadDb();
  if (!Array.isArray(data.farmingTasks)) data.farmingTasks = [];

  const taskId = record.taskId || record.messageId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  record.taskId = taskId;

  // ako već postoji isti messageId → update
  const idx = data.farmingTasks.findIndex(
    (t) => (record.taskId && t.taskId === record.taskId) || (record.messageId && t.messageId === record.messageId)
  );

  if (idx !== -1) {
    data.farmingTasks[idx] = { ...data.farmingTasks[idx], ...record };
  } else {
    data.farmingTasks.push(record);
  }

  saveDb(data);
}

// pronađi zadatak po polju koji je još "open"
function findOpenTaskByField(field, farmKey = null) {
  const data = loadDb();
  if (!Array.isArray(data.farmingTasks)) return null;

  // tražimo od kraja (najnoviji)
  for (let i = data.farmingTasks.length - 1; i >= 0; i--) {
    const t = data.farmingTasks[i];
    if (t.field !== field || t.status !== 'open') continue;
    if (farmKey && resolveFarmConfig(t).key !== farmKey) continue;
    return t;
  }
  return null;
}

function getOpenFieldTasks(farmKey) {
  const data = loadDb();
  const tasks = Array.isArray(data.farmingTasks) ? data.farmingTasks : [];
  return tasks.filter(
    (task) =>
      task.status === 'open' &&
      task.field &&
      resolveFarmConfig(task).key === farmKey
  );
}

function formatTaskPanelTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat('hr-HR', {
    timeZone: 'Europe/Zagreb',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function buildFieldTaskLine(task, index) {
  const base = `Polje ${task.field} - ${task.jobName || 'Posao'}`;
  const extra =
    task.jobKey === 'sijanje' && task.cropName
      ? ` ${task.cropName}`
      : task.jobKey === 'kombajniranje' && task.harvestInfo
        ? ` ${task.harvestInfo}`
        : '';
  const normalizedPriority = String(task.priority || task.priorityLabel || '')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
  const priorityDots = {
    hitno: ' 🔴',
    visok: ' 🟠',
    srednji: ' 🟡',
    nizak: ' 🟢',
  };
  const priority = priorityDots[normalizedPriority] || '';

  return `• ${base}${extra}${priority}`;
}

function buildFarmingTaskPanelEmbed(farm, tasks) {
  const lines = tasks.length
    ? tasks.map((task, index) => buildFieldTaskLine(task, index))
    : ['_Trenutno nema aktivnih radova._'];
  const legend = 'Legenda prioriteta: 🔴 Hitno | 🟠 Visok | 🟡 Srednji | 🟢 Nizak';

  return new EmbedBuilder()
    .setColor('#ffd900')
    .setTitle(`🚜 ${farm.label} - Zadaci`)
    .setDescription(
      `Odaberi što želiš kreirati za ${farm.label}.\n${legend}\n\n${lines.join('\n\n')}\n\n\n`
    )
    .setFooter({
      text: `Ukupno aktivnih radova: ${tasks.length}  |  Zadnje osvježenje: ${formatTaskPanelTimestamp()}`,
    });
}

function buildFarmingTaskPanelRows(farm, hasTasks = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`task_start_${farm.key}`)
        .setLabel('Kreiraj posao (polja)')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`task_general_start_${farm.key}`)
        .setLabel('Kreiraj zadatak')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('task_finish_open')
        .setLabel('Završi zadatak')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasTasks)
    ),
  ];
}

function buildActiveTaskSelectRows(tasks, farmKey) {
  const rows = [];

  for (let i = 0; i < tasks.length && rows.length < 5; i += 25) {
    const slice = tasks.slice(i, i + 25);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`task_finish_select_${farmKey}_${rows.length + 1}`)
      .setPlaceholder(`Odaberi aktivni posao (${i + 1}-${i + slice.length})`)
      .addOptions(
        slice.map((task, index) => ({
          label: buildFieldTaskLine(task, i + index).slice(0, 100),
          value: String(task.taskId || task.messageId),
        }))
      );

    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  return rows;
}

async function updateFarmingTaskPanel(guild, farmKey) {
  if (!guild) return null;

  const farm = getFarmConfig(farmKey);
  const channel = await guild.channels.fetch(farm.jobChannelId).catch(() => null);
  if (!channel) return null;

  const data = loadDb();
  const panelIds = {
    ...buildFarmState(() => null),
    ...(data.farmingTaskPanelMessageIds || {}),
  };
  const tasks = getOpenFieldTasks(farm.key)
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  const embed = buildFarmingTaskPanelEmbed(farm, tasks);
  const components = buildFarmingTaskPanelRows(farm, tasks.length > 0);

  let message = null;
  if (panelIds[farm.key]) {
    message = await channel.messages.fetch(panelIds[farm.key]).catch(() => null);
  }

  if (message) {
    await message.edit({ embeds: [embed], components });
    return message;
  }

  message = await channel.send({ embeds: [embed], components });
  panelIds[farm.key] = message.id;
  data.farmingTaskPanelMessageIds = panelIds;
  saveDb(data);
  return message;
}

// označi zadatak kao završen + prebaci embed u "završene poslove"
// ili kreiraj novi završen zadatak ako ne postoji
async function finishTaskFromFsUpdate(field, payload) {
  const payloadFarmKey = String(payload.farm || payload.farmKey || '').trim().toLowerCase();
  const task = findOpenTaskByField(field, payloadFarmKey || null);
  const farm = task ? resolveFarmConfig(task) : getFarmConfig(payloadFarmKey || 'farm1');
  const finishedBy = payload.player || 'FS Server';
  const status = payload.status || 'finished';
  const jobFromFs = payload.job || null;

  // dohvatimo guild (tvoj glavni)
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;

  const jobChannel = await client.channels.fetch(farm.jobChannelId).catch(() => null);
  const doneChannel = await client.channels.fetch(farm.doneChannelId).catch(() => null);

  if (!doneChannel) return false;

  if (task && !task.messageId) {
    const finishedEmbed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('✅ Zadatak završen (FS)')
      .addFields(
        { name: 'Farma', value: farm.label, inline: true },
        { name: 'Polje', value: `Polje ${task.field}`, inline: true },
        { name: 'Posao', value: task.jobName || jobFromFs || 'Posao', inline: true },
        { name: 'Završio', value: finishedBy, inline: true }
      )
      .setTimestamp();

    if (task.jobKey === 'sijanje' && task.cropName) {
      finishedEmbed.addFields({ name: 'Kultura', value: task.cropName, inline: true });
    }

    if (task.jobKey === 'kombajniranje' && task.harvestInfo) {
      finishedEmbed.addFields({ name: 'Detalji', value: task.harvestInfo, inline: true });
    }

    await doneChannel.send({ embeds: [finishedEmbed] });

    const data = loadDb();
    if (!Array.isArray(data.farmingTasks)) data.farmingTasks = [];
    const idx = data.farmingTasks.findIndex(
      (entry) =>
        (task.taskId && entry.taskId === task.taskId) ||
        (task.messageId && entry.messageId === task.messageId)
    );
    if (idx !== -1) {
      data.farmingTasks[idx].status = 'done';
      data.farmingTasks[idx].finishedBy = finishedBy;
      data.farmingTasks[idx].finishedAt = new Date().toISOString();
      data.farmingTasks[idx].channelId = doneChannel.id;
      data.farmingTasks[idx].farmKey = farm.key;
      data.farmingTasks[idx].farmLabel = farm.label;
      saveDb(data);
    }

    await updateFarmingTaskPanel(guild, farm.key).catch(() => null);
    return true;
  }

  // ako nema spremljenog zadatka za ovo polje
  if (!task || !jobChannel) {
    const jobName = jobFromFs || `Posao sa FS (${status})`;

    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('✅ Zadatak (auto iz FS)')
      .addFields(
        { name: 'Polje', value: `Polje ${field}`, inline: true },
        { name: 'Posao', value: jobName, inline: true },
        { name: 'Završio', value: finishedBy, inline: true }
      )
      .setTimestamp();

    const msg = await doneChannel.send({ embeds: [embed] });

    saveFarmingTask({
      farmKey: farm.key,
      farmLabel: farm.label,
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
      `✅ FS: Nije pronađen aktivni zadatak za polje ${field}, kreiran novi "završen" zadatak.`
    );

    return true;
  }

  // imamo otvoreni zadatak u kanalu za poslove → dohvatimo stari embed
  const msg = await jobChannel.messages
    .fetch(task.messageId)
    .catch(() => null);
  if (!msg || !msg.embeds[0]) return false;

  const oldEmbed = msg.embeds[0];

  const finishedEmbed = EmbedBuilder.from(oldEmbed)
    .setColor('#ff0000')
    .setTitle('✅ Zadatak završen (FS)')
    .setFooter({
      text: 'Označeno kao završeno od strane: ' + finishedBy,
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
    data.farmingTasks[idx].farmKey = resolveFarmConfig(data.farmingTasks[idx]).key;
    saveDb(data);
  }

  await updateFarmingTaskPanel(guild, farm.key).catch(() => null);

  console.log(
    `✅ FS: Zadatak za polje ${field} automatski označen kao završen.`
  );

  return true;
}

// =====================
//  FS WEBHOOK – field update (auto završavanje posla)
// =====================
app.post('/fs/field-update', async (req, res) => {
  if (!checkFsSecret(req, res)) return;

  const payload = req.body || {};
  const field = String(payload.field || '').trim();
  const status = String(payload.status || '').toLowerCase();

  console.log('🌾 [FS FIELD UPDATE]', payload);

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

    // 🌾 Ako FS završi posao koji je sijanje, zabilježi ga u sezoni
try {
  const crop = payload.crop || payload.seed || null;

  if (crop) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (guild) {
      await handleNewSowingTask(guild, field, crop);
    }
  }
} catch (e) {
  console.log("⚠️ Greška pri upisu FS sjetve u sezonu:", e);
}


    return res.json({ ok: true, finished: true });
  } catch (err) {
    console.error('❌ Greška u /fs/field-update:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

initMySql().finally(() => {
  app.listen(PORT, () => {
    console.log(`🌐 Dashboard listening on port ${PORT}`);
  });
});

// =====================
//  DISCORD BOT DIO
// =====================

// ❗ kategorija gdje idu tiketi (default, može se override-ati u dashboardu)
const TICKET_CATEGORY_ID = '1437220354992115912';

// ❗ kanal gdje ide TRANSKRIPT zatvorenih tiketa  (default, može se override-ati u dashboardu)
const TICKET_LOG_CHANNEL_ID = '1437218054718095410';
const FARM_FIELD_PANEL_CHANNEL_ID = '1488997083481636905';

const FARM_CONFIGS = {
  farm1: {
    key: 'farm1',
    label: FARM_LABELS.farm1,
    jobChannelId: '1488991604718043359',
    doneChannelId: '1488991718798917823',
  },
  farm2: {
    key: 'farm2',
    label: FARM_LABELS.farm2,
    jobChannelId: '1488991802177486939',
    doneChannelId: '1488991841834766356',
  },
  farm3: {
    key: 'farm3',
    label: FARM_LABELS.farm3,
    jobChannelId: '1496980500961820843',
    doneChannelId: '1496980713969422508',
  },
};

function getFarmConfig(farmKey) {
  return FARM_CONFIGS[farmKey] || FARM_CONFIGS.farm1;
}

function getTaskCommandFarmKey(commandName) {
  return TASK_PANEL_COMMAND_TO_FARM[String(commandName || '').trim()] || null;
}

function getFarmKeyFromCustomId(customId, prefix) {
  if (typeof customId !== 'string' || !customId.startsWith(prefix)) return null;

  const farmKey = customId.slice(prefix.length);
  return KNOWN_FARM_KEYS.includes(farmKey) ? farmKey : null;
}

function buildFarmChoiceRows(prefix, labelBuilder, style) {
  const rows = [];

  for (let i = 0; i < KNOWN_FARM_KEYS.length; i += 5) {
    const buttons = KNOWN_FARM_KEYS.slice(i, i + 5).map((farmKey) => {
      const farm = getFarmConfig(farmKey);
      return new ButtonBuilder()
        .setCustomId(`${prefix}${farmKey}`)
        .setLabel(labelBuilder(farm))
        .setStyle(style);
    });

    rows.push(new ActionRowBuilder().addComponents(...buttons));
  }

  return rows;
}

function buildFieldActionChoiceRows(action) {
  if (action === 'add') {
    return buildFarmChoiceRows(
      'field_add_button_',
      (farm) => `Dodaj u ${farm.label}`,
      ButtonStyle.Success
    );
  }

  if (action === 'update') {
    return buildFarmChoiceRows(
      'field_update_button_',
      (farm) => `Uredi ${farm.label}`,
      ButtonStyle.Primary
    );
  }

  if (action === 'remove') {
    return buildFarmChoiceRows(
      'field_remove_button_',
      (farm) => `Briši iz ${farm.label}`,
      ButtonStyle.Danger
    );
  }

  return [];
}

function resolveFarmConfig(taskLike = {}) {
  if (taskLike.farmKey && FARM_CONFIGS[taskLike.farmKey]) {
    return FARM_CONFIGS[taskLike.farmKey];
  }

  const byActiveChannel = Object.values(FARM_CONFIGS).find(
    (farm) => farm.jobChannelId === taskLike.channelId
  );
  if (byActiveChannel) return byActiveChannel;

  const byDoneChannel = Object.values(FARM_CONFIGS).find(
    (farm) => farm.doneChannelId === taskLike.channelId
  );
  if (byDoneChannel) return byDoneChannel;

  return FARM_CONFIGS.farm1;
}

// ❗ kanal gdje idu FS25 TELEMETRY logovi (embed s vozilom)
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
  const actionEmoji = isRemove ? '✅' : '⛔';

  const userDisplay = userId ? `<@${userId}>` : (details.korisnik || '-');
  const actorDisplay = actorId
    ? `<@${actorId}>`
    : (details.dodao || details.maknuo || '-');

  const fields = [
    {
      name: '👤 Korisnik',
      value: `${userDisplay}\n\`${userId || details.korisnik || '-'}\``,
      inline: true,
    },
    {
      name: `🛡️ ${actorLabel}`,
      value: `${actorDisplay}\n\`${actorId || details.dodao || details.maknuo || '-'}\``,
      inline: true,
    },
  ];

  if (details.razlog) {
    fields.push({
      name: '📝 Razlog',
      value: details.razlog,
      inline: false,
    });
  } else if (!isRemove) {
    fields.push({
      name: '📝 Razlog',
      value: '[prazno]',
      inline: false,
    });
  }

  return {
    color,
    title: `${actionEmoji} ${title}`,
    fields,
    footerText: `User ID: ${userId || '-'} • ${new Date().toLocaleString('hr-HR')}`,
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
const activeTasks = new Map(); // key: userId, value: { field: string | null, farmKey?: string }
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

console.log('▶ Pokrećem bota...');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages, // za messageCreate
  ],
});

client.once('ready', async () => {
  console.log(`✅ Bot je online kao ${client.user.tag}`);

  try {
    await initPollStorage(dbPool);
    await restoreActivePolls(client);
  } catch (err) {
    console.log('Poll MySQL init/restore error:', err.message);
  }

  // 🌾 AUTOMATSKO OBNAVLJANJE SEZONE SJETVE PRI STARTU BOTA
  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (guild) {
      await refreshSharedBotConfigFromMySql(true);
      await updateSeasonEmbed(guild);
      await updateFarmingFieldsEmbed(guild);
      for (const farmKey of KNOWN_FARM_KEYS) {
        await updateFarmingTaskPanel(guild, farmKey);
      }
      for (const farmKey of KNOWN_FARM_KEYS) {
        await updateSowingTableMessage(guild, farmKey);
      }
      await updateDiscordBanPanel(guild);
      console.log("🌾 Sezona Sjetve — embed obnovljen pri startu bota.");
    }
  } catch (err) {
    console.log("⚠️ Greška pri obnavljanju Sezone Sjetve:", err);
  }
  await registerApplicationCommands();
});


client.on('error', (err) => {
  console.error('❌ Client error:', err);
});

client.on('guildBanAdd', async (ban) => {
  try {
    const auditEntry = await fetchMatchingBanAuditEntry(ban.guild, ban.user.id);
    await upsertDiscordBanRecord({
      guildId: ban.guild.id,
      userId: ban.user.id,
      userTag: getDiscordBanDisplayName(ban.user, ban.user.id),
      reason: String(ban.reason || auditEntry?.reason || '').trim(),
      bannedAt: auditEntry?.createdAt?.toISOString?.() || new Date().toISOString(),
      executorId: auditEntry?.executor?.id || '',
      executorTag: auditEntry?.executor
        ? getDiscordBanDisplayName(auditEntry.executor, auditEntry.executor.id)
        : '',
    });
    await updateDiscordBanPanel(ban.guild, {
      selectedUserId: ban.user.id,
    });
  } catch (error) {
    console.log('Discord ban panel update on guildBanAdd failed:', error.message);
  }
});

client.on('guildBanRemove', async (ban) => {
  try {
    await removeDiscordBanRecord(ban.guild.id, ban.user.id);
    await updateDiscordBanPanel(ban.guild);
  } catch (error) {
    console.log('Discord ban panel update on guildBanRemove failed:', error.message);
  }
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
      console.error('Greška pri slanju ticket remindera:', err);
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

      // ako je već ručno zatvoren
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

      // zaključaj permisije
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

      // pošalji transkript (bot kao "zatvorio")
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

      // obriši kanal nakon 10 sekundi
      setTimeout(() => {
        ch.delete().catch(() => {});
      }, 10_000);
    } catch (err) {
      console.error('Greška u auto-close tiketa:', err);
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
    .setCustomId(`ticket_category:${Date.now().toString(36)}`)
    .setPlaceholder('Odaberi vrstu tiketa')
    .addOptions(
      {
        label: 'Igranje na serveru',
        description: 'Godine + svako pitanje zasebno u istom modalu.',
        value: 'igranje',
        emoji: '🎮',
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

function buildTicketPanelEmbed(cfg) {
  const igranjeTitle = cfg?.types?.igranje?.title || 'Igranje na serveru';
  const zalbaTitle = cfg?.types?.zalba?.title || 'Žalba na igrače';
  const modoviTitle = cfg?.types?.modovi?.title || 'Edit modova';
  const pomocTitle = cfg?.types?.pomoc?.title || 'Pomoć';

  return new EmbedBuilder()
    .setColor('#ffd000')
    .setTitle('Ticket sustav')
    .setDescription(
      [
        'Molimo vas da pažljivo pročitate ovu poruku prije nego što otvorite tiket.',
        '',
        '**Opcije:**',
        `• **${igranjeTitle}:** zahtjev za pridruživanje serveru i kratki modal upitnik.`,
        `• **${zalbaTitle}:** prijava igrača koji krši pravila servera.`,
        `• **${modoviTitle}:** pomoć, ideje ili problemi vezani uz edit modova.`,
        `• **${pomocTitle}:** pitanja ili problemi za admin tim.`,
        '',
        'Nakon odabira opcije otvorit će se modal s pitanjima za tu kategoriju.',
        '',
        '**Prije otvaranja tiketa:**',
        '1. Provjerite jeste li sve instalirali i podesili prema uputama.',
        '2. Pokušajte sami riješiti problem i provjerite da nije do vaših modova ili klijenta.',
        '3. Ako ne uspijete, otvorite tiket i detaljno opišite svoj problem.',
        '4. Budite strpljivi, netko iz tima će vam se javiti čim bude moguće.',
        '',
        '**Pravila tiketa:**',
        '• Svi problemi moraju biti jasno i detaljno opisani, bez poruka tipa "ne radi".',
        '• Poštujte članove staff tima.',
        '• Ne pingajte staff bez razloga, netko će vam se javiti.',
        `• Tiket bez odgovora korisnika ${cfg?.autoCloseHours || 48}h bit će zatvoren.`,
        '• Ne otvarajte tikete u pogrešnoj kategoriji.',
        '• Kršenje pravila može rezultirati zatvaranjem tiketa ili sankcijama.',
      ].join('\n')
    );
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
            `⛔ Blacklist korisnik se vratio: ${member.user.tag} (ID: ${member.id})` +
              (blacklistEntry.reason ? ` | Razlog: ${blacklistEntry.reason}` : '')
          )
          .catch(() => {});
        return;
      }
      logCh
        .send(`✅ Novi član: ${member.user.tag} (ID: ${member.id})`)
        .catch(() => {});
    }
  }
});

// ============== MESSAGE CREATE (tiketi: reminder + inactivity) ==============
client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const channel = message.channel;

  // ako je ovo tiket koji pratimo za inactivity → reset Xh timera
  if (ticketInactivity.has(channel.id)) {
    startTicketInactivity(channel);
  }

  // ako nema reminder za ovaj kanal, dalje nas ništa ne zanima
  if (!ticketReminders.has(channel.id)) return;

  const topic = channel.topic || '';
  const match = topic.match(/Ticket owner:\s*(\d+)/i);
  const ticketOwnerId = match ? match[1] : null;

  if (!ticketOwnerId) return;
  if (message.author.id !== ticketOwnerId) return;

  // vlasnik tiketa je odgovorio → zaustavi reminder
  stopTicketReminder(channel.id);
});

// ============== SLASH KOMANDE + INTERAKCIJE ==============
client.on('interactionCreate', async (interaction) => {
  // ---------- SLASH KOMANDE ----------
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'modal') {
      if (!memberHasAnyRole(interaction.member, ANNOUNCEMENT_ALLOWED_ROLE_IDS)) {
        return interaction.reply({
          content: 'Samo Admin, Suvlasnik servera i Gazda mogu koristiti ovu komandu.',
          ephemeral: true,
        });
      }

      const selectedRole1 = interaction.options.getRole('uloga1', true);
      const selectedRole2 = interaction.options.getRole('uloga2');
      pendingAnnouncementRoles.set(interaction.user.id, {
        roleIds: [selectedRole1?.id, selectedRole2?.id].filter(Boolean),
        channelId: interaction.channelId,
      });

      await interaction.showModal(buildAnnouncementModal());
      return;
    }

    if (interaction.commandName === 'anketa') {
      let repliedToCommand = false;

      try {
        await interaction.deferReply({ ephemeral: true });
        repliedToCommand = true;
      } catch (error) {
        if (isUnknownInteractionError(error)) {
          console.error('ANKETA COMMAND ERROR: interaction expired before deferReply.');
        } else {
          throw error;
        }
      }

      await postPollPanel(interaction, client);

      if (repliedToCommand) {
        try {
          await interaction.editReply({
            content: 'Panel za ankete je postavljen u trazeni kanal.',
          });
        } catch (error) {
          if (isUnknownInteractionError(error)) {
            console.error('ANKETA COMMAND ERROR: interaction expired before editReply.');
          } else {
            throw error;
          }
        }
      }

      return;
    }

    // /ticket-panel
    if (interaction.commandName === 'ticket-panel') {
      await refreshSharedBotConfigFromMySql(true);
      const cfg = getTicketConfig();
      const embed = buildTicketPanelEmbed(cfg);
      const row = buildTicketCategoryRow();

      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();

      const channel = interaction.channel;
      await channel.send({ embeds: [embed], components: [row] });
      return;
    }

    const taskPanelFarmKey = getTaskCommandFarmKey(interaction.commandName);
    if (taskPanelFarmKey) {
      await interaction.deferReply({ ephemeral: true });
      await refreshSharedBotConfigFromMySql(true);
      await updateFarmingTaskPanel(interaction.guild, taskPanelFarmKey);
      await interaction.editReply({
        content: `✅ Panel za ${getFarmConfig(taskPanelFarmKey).label} je osvježen.`,
      });
      return;
    }

    // /task1 i /task2 – Farming zadaci
if (interaction.commandName === 'task1' || interaction.commandName === 'task2') {
  const farmKey = interaction.commandName === 'task2' ? 'farm2' : 'farm1';
  const farm = getFarmConfig(farmKey);
  const embed = new EmbedBuilder()
    .setColor('#ffd900')
    .setTitle(`🚜 ${farm.label} – Zadaci`)
    .setDescription(`Odaberi što želiš kreirati za ${farm.label}.`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`task_start_${farm.key}`)
      .setLabel('➕ Kreiraj posao (polja)')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`task_general_start_${farm.key}`)
      .setLabel('📝 Kreiraj zadatak')
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
          content: '⛔ Samo staff/admin može dodavati nova polja.',
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: 'Odaberi za koju farmu želiš dodati novo polje.',
        components: buildFieldActionChoiceRows('add'),
        ephemeral: true,
      });
    }

    // /remove-field value:<string>
    if (interaction.commandName === 'remove-field') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može brisati polja.',
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: 'Odaberi za koju farmu želiš obrisati polje.',
        components: buildFieldActionChoiceRows('remove'),
        ephemeral: true,
      });
    }

    // /list-fields
    if (interaction.commandName === 'list-fields') {
      const farmKey = interaction.options.getString('farm', true);
      const farm = getFarmConfig(farmKey);
      const fields = getFarmingFields(farm.key);

      if (!fields.length) {
        return interaction.reply({
          content: `Lista polja za ${farm.label} je trenutno prazna.`,
          ephemeral: true,
        });
      }

      return interaction.reply({
        content:
          `📋 Trenutna polja za ${farm.label}:\n` +
          fields.map((f) => `• ${f}`).join('\n'),
        ephemeral: true,
      });
    }

    // /field-panel – poruka s gumbom za dodavanje polja
    if (interaction.commandName === 'field-panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može postaviti ovaj panel.',
          ephemeral: true,
        });
      }
      const panelChannel = await interaction.guild.channels
        .fetch(FARM_FIELD_PANEL_CHANNEL_ID)
        .catch(() => null);

      if (!panelChannel) {
        return interaction.reply({
          content: '⚠️ Kanal za panel polja nije pronađen.',
          ephemeral: true,
        });
      }

      await updateFarmingFieldsEmbed(interaction.guild);
      await interaction.reply({
        content: `✅ Panel za polja je poslan u kanal <#${FARM_FIELD_PANEL_CHANNEL_ID}>.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'tablica') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može postaviti tablicu sjetve.',
          ephemeral: true,
        });
      }

      for (const farmKey of KNOWN_FARM_KEYS) {
        saveSowingTableState(farmKey, {
          ...getSowingTableState(farmKey),
          channelId: SOWING_TABLE_CHANNEL_IDS[farmKey],
        });
      }

      for (const farmKey of KNOWN_FARM_KEYS) {
        await updateSowingTableMessage(interaction.guild, farmKey);
      }
      await interaction.reply({
        content: `✅ Tablice sjetve su postavljene ili osvježene u kanalima ${KNOWN_FARM_KEYS.map((farmKey) => `<#${SOWING_TABLE_CHANNEL_IDS[farmKey]}>`).join(', ')}.`,
        ephemeral: true,
      });
      scheduleInteractionReplyDeletion(interaction, 2000);
      return;
    }

    // /reset-season – resetira aktivnu sezonu sjetve
    if (interaction.commandName === 'blacklist') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može dodavati korisnike na ticket blacklistu.',
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
          '⛔ Korisnik dodan na ticket blacklistu',
          `Korisnik: ${targetUser.tag} (${targetUser.id})`,
          `Dodao: ${interaction.user.tag} (${interaction.user.id})`,
          entry.reason ? `Razlog: ${entry.reason}` : null,
        ].filter(Boolean).join('\n')
      );

      return interaction.reply({
        content:
          `⛔ <@${targetUser.id}> je dodan na ticket blacklistu i vise ne moze otvarati tickete.` +
          (entry.reason ? `\nRazlog: ${entry.reason}` : ''),
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'unblacklist') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može skidati korisnike s ticket blackliste.',
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
            '✅ Korisnik maknut s ticket blackliste',
            `Korisnik: ${targetUser.tag} (${targetUser.id})`,
            `Maknuo: ${interaction.user.tag} (${interaction.user.id})`,
          ].join('\n')
        );
      }

      return interaction.reply({
        content: removed
          ? `✅ <@${targetUser.id}> je maknut s ticket blackliste i ponovno moze otvarati tickete.`
          : `⚠️ <@${targetUser.id}> nije bio na ticket blackliste.`,
        ephemeral: true,
      });
    }

if (interaction.commandName === 'reset-season') {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '⛔ Nemaš permisije za reset sezone.',
      ephemeral: true,
    });
  }


  const seasons = getSowingSeasons();
  const active = getActiveSeason();

  // 1️⃣ Resetiramo polja
  active.fields = {};
  active.completed = false;

  // 2️⃣ Zapišemo nazad u DB
  const index = seasons.findIndex(s => s.season === active.season);
  seasons[index] = active;
  saveSowingSeasons(seasons);

  // 3️⃣ Očistimo embed totalno
  await updateSeasonEmbed(interaction.guild, true);

  return interaction.reply({
    content: '🔄 Sezona resetirana! Živi embed je očišćen.',
    ephemeral: true,
  });
}

// /update-field
if (interaction.commandName === 'update-field') {
  // samo staff
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: '⛔ Samo staff može uređivati polja.',
      ephemeral: true,
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('field_update_button_farm1')
      .setLabel('Uredi Farmu 1')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('field_update_button_farm2')
      .setLabel('Uredi Farmu 2')
      .setStyle(ButtonStyle.Primary)
  );

  return interaction.reply({
    content: 'Odaberi za koju farmu želiš urediti polje.',
    components: buildFieldActionChoiceRows('update'),
    ephemeral: true,
  });

}


 }

  // ---------- KREIRANJE TIKETA (dropdown) ----------
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith('ban_panel_select:')
  ) {
    if (!canManageDiscordBans(interaction.member)) {
      return interaction.reply({
        content: 'Nemas ovlast za pregled i upravljanje ban listom.',
        ephemeral: true,
      });
    }

    const [, pageRaw] = interaction.customId.split(':');
    const entries = await getDiscordBanEntries(interaction.guild);
    const nextPage = getDiscordBanPageForUser(
      entries,
      interaction.values[0],
      Number(pageRaw || 0)
    );
    const payload = await createDiscordBanPanelPayload(interaction.guild, {
      page: nextPage,
      selectedUserId: interaction.values[0],
    });
    await interaction.update(payload);
    return;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith('ticket_category')
  ) {
    await refreshSharedBotConfigFromMySql(true);
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
            `🎮 Pozdrav <@${member.id}>, hvala što si otvorio **${typeCfg.title || 'Igranje na serveru'}** ticket.`,
            '',
            '# 🧾 Evo da skratimo stvari i ubrzamo proces',
            '',
            '**Odgovori na sljedeća pitanja:**',
            '',
            ...typeCfg.questions.map((q) => `- ${q}`),
            '',
            '🕹️ Kada odgovoriš na ova pitanja, neko iz tima će ti se ubrzo javiti.',
          ].join('\n');
        } else {
          ticketMessage = [
            `🎮 Pozdrav <@${member.id}>, hvala što si otvorio **Igranje na serveru** ticket.`,
            '',
            '# 🧾 Evo da skratimo stvari i ubrzamo proces',
            '',
            '**Imaš par pitanja pa čisto da vlasnik ne gubi vrijeme kad preuzme ovaj tiket.**',
            '',
            '- Koliko često planiraš da igraš na serveru? (npr. svakodnevno, par puta nedeljno...)',
            '- U koje vrijeme si najčešće aktivan? (npr. popodne, uveče, vikendom...)',
            '- Da li si spreman da poštuješ raspored i obaveze na farmi (npr. oranje, žetva, hranjenje stoke)?',
            '- Kako bi reagovao ako neko iz tima ne poštuje dogovor ili pravila igre?',
            '- Da li koristiš voice chat (Discord) tokom igre?',
            '- Da li si spreman da pomogneš drugim igračima (npr. novim članovima tima)?',
            '- Zašto želiš da igraš baš na hard serveru?',
            '',
            '🕹️ Kada odgovoriš na ova pitanja, neko iz tima će ti se ubrzo javiti.',
          ].join('\n');
        }
        break;

      case 'zalba':
        if (typeCfg && typeCfg.questions?.length) {
          ticketMessage = [
            `⚠️ Pozdrav <@${member.id}>, hvala što si otvorio **${typeCfg.title || 'žalbu na igrače'}** ticket.`,
            '',
            '**Molimo te da odgovoriš na sljedeća pitanja:**',
            '',
            ...typeCfg.questions.map((q) => `- ${q}`),
            '',
            '👮 Moderatori će pregledati prijavu i javiti ti se.',
          ].join('\n');
        } else {
          ticketMessage =
            `⚠️ Pozdrav <@${member.id}>, hvala što si otvorio **žalbu na igrače**.\n` +
            'Molimo te da navedeš:\n' +
            '• Ime igrača na kojeg se žališ\n' +
            '• Vrijeme i detaljan opis situacije\n' +
            '• Dokaze (slike, video, logovi) ako ih imaš.\n' +
            '👮 Moderatori će pregledati prijavu i javiti ti se.';
        }
        break;

      case 'modovi':
        if (typeCfg && typeCfg.questions?.length) {
          ticketMessage = [
            `🧩 Pozdrav <@${member.id}>, hvala što si otvorio **${typeCfg.title || 'izrada modova'}** ticket.`,
            '',
            '**Kako bismo ti lakše pomogli, odgovori na sljedeća pitanja:**',
            '',
            ...typeCfg.questions.map((q) => `- ${q}`),
            '',
            '💡 Što više informacija daš, lakše ćemo pomoći.',
          ].join('\n');
        } else {
          ticketMessage =
            `🧩 Pozdrav <@${member.id}>, hvala što si otvorio **izrada modova** ticket.\n` +
            'Opiši kakav mod radiš ili s kojim dijelom imaš problem.\n' +
            '💡 Slobodno pošalji kod, ideju ili primjer – što više informacija daš, lakše ćemo pomoći.';
        }
        break;

      default:
        ticketMessage =
          `👋 Pozdrav <@${member.id}>, hvala što si otvorio ticket.\n` +
          'Molimo te da opišeš svoj problem što detaljnije.';
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

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith('task_field_select_')
  ) {
    const fieldId = interaction.values[0];
    const current = activeTasks.get(interaction.user.id) || {};
    const farm = getFarmConfig(current.farmKey || 'farm1');
    current.field = fieldId;
    current.transientMessageId = interaction.message?.id || current.transientMessageId;
    activeTasks.set(interaction.user.id, current);

    const nextEmbed = new EmbedBuilder()
      .setColor('#00a84d')
      .setTitle('🚜 Kreiranje zadatka – Korak 2')
      .setDescription(
        `${farm.label}\nOdabrano polje: **Polje ${fieldId}**\n\nSada odaberi vrstu posla:`
      );

    const nextJobsRow1 = new ActionRowBuilder().addComponents(
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
        .setLabel('Đubrenje')
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

    const nextJobsRow2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('task_job_herbicid')
        .setLabel('Herbicid')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('task_job_kosnja_trave')
        .setLabel('Košnja trave')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('task_job_kosnja_djeteline')
        .setLabel('Košnja djeteline')
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

    const nextJobsRow3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('task_job_malciranje')
        .setLabel('Malčiranje')
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

    const nextJobsRow4 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('task_job_zamotavanje')
        .setLabel('Zamotati bale za silažu')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('task_job_zimska')
        .setLabel('Zimska brazda')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('task_job_ceste')
        .setLabel('Čišćenje ceste')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('task_job_rolanje')
        .setLabel('Rolanje polja')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('task_job_silaza')
        .setLabel('Silaža')
        .setStyle(ButtonStyle.Primary)
    );

    return interaction.update({
      embeds: [nextEmbed],
      components: [nextJobsRow1, nextJobsRow2, nextJobsRow3, nextJobsRow4],
    });

    const embed = new EmbedBuilder()
      .setColor('#00a84d')
      .setTitle('ðŸšœ Kreiranje zadatka â€“ Korak 2')
      .setDescription(
        `${farm.label}\nOdabrano polje: **Polje ${fieldId}**\n\nSada odaberi vrstu posla:`
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
        .setLabel('Äubrenje')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('task_job_tanjiranje')
        .setLabel('Tanjiranje')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('task_job_kultivacija')
        .setLabel('Kultivacija')
        .setStyle(ButtonStyle.Primary)
    );

    const jobsRow2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('task_job_sjetva')
        .setLabel('Sjetva')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('task_job_prskanje')
        .setLabel('Prskanje')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('task_job_zetva')
        .setLabel('Å½etva')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('task_job_baliranje')
        .setLabel('Baliranje')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('task_job_rolanje')
        .setLabel('Rolanje')
        .setStyle(ButtonStyle.Secondary)
    );

    const jobsRow3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('task_job_spajanje')
        .setLabel('Spajanje')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      embeds: [embed],
      components: [jobsRow1, jobsRow2, jobsRow3],
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith('task_finish_select_')
  ) {
    const selectedTaskId = interaction.values[0];
    const db = loadDb();
    const task = Array.isArray(db.farmingTasks)
      ? db.farmingTasks.find(
          (entry) =>
            entry.status === 'open' &&
            ((entry.taskId && entry.taskId === selectedTaskId) ||
              (entry.messageId && entry.messageId === selectedTaskId))
        )
      : null;

    if (!task) {
      return interaction.reply({
        content: '⚠️ Odabrani posao više nije aktivan.',
        ephemeral: true,
      });
    }

    const farm = resolveFarmConfig(task);
    const doneChannel = await interaction.guild.channels.fetch(farm.doneChannelId).catch(() => null);
    if (!doneChannel) {
      return interaction.reply({
        content: '⚠️ Kanal za završene poslove nije pronađen.',
        ephemeral: true,
      });
    }

    const finishedEmbed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('✅ Zadatak završen')
      .addFields(
        { name: 'Farma', value: farm.label, inline: true },
        { name: 'Polje', value: `Polje ${task.field}`, inline: true },
        { name: 'Posao', value: task.jobName || 'Posao', inline: true },
        { name: 'Završio', value: interaction.user.tag, inline: true }
      )
      .setTimestamp();

    if (task.jobKey === 'sijanje' && task.cropName) {
      finishedEmbed.addFields({ name: 'Kultura', value: task.cropName, inline: true });
    }

    if (task.jobKey === 'kombajniranje' && task.harvestInfo) {
      finishedEmbed.addFields({ name: 'Detalji', value: task.harvestInfo, inline: true });
    }

    await doneChannel.send({ embeds: [finishedEmbed] });

    task.status = 'done';
    task.channelId = doneChannel.id;
    task.farmKey = farm.key;
    task.farmLabel = farm.label;
    task.finishedBy = interaction.user.tag;
    task.finishedAt = new Date().toISOString();
    saveDb(db);

    if (task.messageId) {
      const jobChannel = await interaction.guild.channels.fetch(farm.jobChannelId).catch(() => null);
      const oldMsg = jobChannel
        ? await jobChannel.messages.fetch(task.messageId).catch(() => null)
        : null;
      if (oldMsg && oldMsg.id !== (db.farmingTaskPanelMessageIds || {})[farm.key]) {
        await oldMsg.delete().catch(() => {});
      }
    }

    await updateFarmingTaskPanel(interaction.guild, farm.key).catch(() => null);

    await interaction.update({
      content: `✅ Završeno: ${buildFieldTaskLine(task, 0).replace(/^1\.\s*/, '')}`,
      embeds: [],
      components: [],
    });
    setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, 1500);
    return;
  }

  // ---------- BUTTONI (TICKETI + FARMING) ----------
  if (interaction.isButton()) {
    if (await handlePollButton(interaction, client)) {
      return;
    }

    if (interaction.customId.startsWith('ban_panel:')) {
      if (!canManageDiscordBans(interaction.member)) {
        return interaction.reply({
          content: 'Nemas ovlast za upravljanje Discord banovima.',
          ephemeral: true,
        });
      }

      const [, action, pageRaw, selectedRaw] = interaction.customId.split(':');
      const currentPage = Number(pageRaw || 0);
      const selectedUserId = selectedRaw && selectedRaw !== 'none' ? selectedRaw : '';

      if (action === 'ban') {
        return interaction.showModal(buildDiscordBanModal(currentPage));
      }

      if (action === 'unban') {
        if (!selectedUserId) {
          return interaction.reply({
            content: 'Prvo odaberi korisnika kojeg zelis unbanati.',
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          await interaction.guild.members.unban(
            selectedUserId,
            `Unban preko ban panela od ${interaction.user.tag}`
          );
          await removeDiscordBanRecord(interaction.guild.id, selectedUserId);
          await updateDiscordBanPanel(interaction.guild, {
            page: currentPage,
          });
          await interaction.editReply({
            content: `Korisnik <@${selectedUserId}> je unbanan preko panela.`,
          });
        } catch (error) {
          await interaction.editReply({
            content: `Unban nije uspio: ${error.message}`,
          });
        }
        return;
      }

      let nextPage = currentPage;
      if (action === 'prev') {
        nextPage -= 1;
      } else if (action === 'next') {
        nextPage += 1;
      }

      const payload = await createDiscordBanPanelPayload(interaction.guild, {
        page: nextPage,
        selectedUserId: '',
      });
      await interaction.update(payload);
      return;
    }

    if (interaction.customId.startsWith('sowing_table_')) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može uređivati tablicu sjetve.',
          ephemeral: true,
        });
      }

      const farmKey = resolveSowingTableFarmKey(interaction.channelId) || 'farm2';

      if (interaction.customId === 'sowing_table_refresh') {
        await updateSowingTableMessage(interaction.guild, farmKey);
        await interaction.reply({
          content: `✅ Tablica sjetve za ${getFarmConfig(farmKey).label} je osvježena.`,
          ephemeral: true,
        });
        scheduleInteractionReplyDeletion(interaction, 1500);
        return;
      }

      if (interaction.customId === 'sowing_table_add') {
        const modal = new ModalBuilder()
          .setCustomId('sowing_table_add_modal')
          .setTitle('Dodaj red u tablicu');

        const inputs = [
          ['field', 'Polje'],
          ['year1', '1. godina'],
          ['year2', '2. godina'],
          ['year3', '3. godina'],
          ['year4', '4. godina'],
        ].map(([id, label]) =>
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(id)
              .setLabel(label)
              .setStyle(TextInputStyle.Short)
              .setRequired(id === 'field')
              .setMaxLength(120)
          )
        );

        modal.addComponents(...inputs);
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'sowing_table_edit') {
        const modal = new ModalBuilder()
          .setCustomId('sowing_table_edit_modal')
          .setTitle('Uredi red u tablici');

        const inputs = [
          ['field', 'Polje koje uređuješ'],
          ['year1', '1. godina'],
          ['year2', '2. godina'],
          ['year3', '3. godina'],
          ['year4', '4. godina'],
        ].map(([id, label]) =>
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(id)
              .setLabel(label)
              .setStyle(TextInputStyle.Short)
              .setRequired(id === 'field')
              .setMaxLength(120)
          )
        );

        modal.addComponents(...inputs);
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'sowing_table_years') {
        const state = getSowingTableState(farmKey);
        const modal = new ModalBuilder()
          .setCustomId('sowing_table_years_modal')
          .setTitle('Promijeni nazive godina');

        const inputs = state.yearLabels.map((label, index) =>
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(`year_label_${index + 1}`)
              .setLabel(`${index + 1}. stupac`)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(label)
              .setMaxLength(80)
          )
        );

        modal.addComponents(...inputs);
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'sowing_table_delete') {
        const modal = new ModalBuilder()
          .setCustomId('sowing_table_delete_modal')
          .setTitle('Obriši red iz tablice');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('field')
              .setLabel('Polje koje želiš obrisati')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(120)
          )
        );

        await interaction.showModal(modal);
        return;
      }
    }

    if (taskPanelFarmKey) {
      await interaction.deferReply({ ephemeral: true });
      await updateFarmingTaskPanel(interaction.guild, taskPanelFarmKey);
      await interaction.editReply({
        content: `✅ Panel za ${getFarmConfig(taskPanelFarmKey).label} je osvježen.`,
      });
      return;
    }

    if (interaction.customId === 'task_finish_open') {
      const farm = getFarmConfig(
        Object.values(FARM_CONFIGS).find((entry) => entry.jobChannelId === interaction.channelId)?.key || 'farm1'
      );
      const tasks = getOpenFieldTasks(farm.key)
        .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

      if (!tasks.length) {
        return interaction.reply({
          content: '⚠️ Trenutno nema aktivnih poslova za završiti.',
          ephemeral: true,
        });
      }

      return interaction.reply({
        content: `Odaberi aktivni posao za ${farm.label}:`,
        components: buildActiveTaskSelectRows(tasks, farm.key),
        ephemeral: true,
      });
    }

    if (interaction.customId.startsWith('ticket_modal_continue:')) {
      const [, type, stepRaw] = interaction.customId.split(':');
      const cfg = getTicketConfig();
      const typeCfg = cfg.types[type];
      const stepIndex = Number(stepRaw || 0);

      if (!typeCfg) {
        return interaction.reply({
          content: '⚠️ Ticket forma nije pronađena. Pokušaj ponovno.',
          ephemeral: true,
        });
      }

      return interaction.showModal(buildTicketQuestionModal(type, typeCfg, stepIndex));
    }

    if (interaction.customId === 'field_action_add') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('field_add_button_farm1')
          .setLabel('Dodaj u Farmu 1')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('field_add_button_farm2')
          .setLabel('Dodaj u Farmu 2')
          .setStyle(ButtonStyle.Success)
      );

      return interaction.reply({
        content: 'Za koju farmu želiš dodati polje?',
        components: buildFieldActionChoiceRows('add'),
        ephemeral: true,
      });
    }

    if (interaction.customId === 'field_action_update') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('field_update_button_farm1')
          .setLabel('Uredi Farmu 1')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('field_update_button_farm2')
          .setLabel('Uredi Farmu 2')
          .setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({
        content: 'Za koju farmu želiš urediti polje?',
        components: buildFieldActionChoiceRows('update'),
        ephemeral: true,
      });
    }

    if (interaction.customId === 'field_action_remove') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('field_remove_button_farm1')
          .setLabel('Briši iz Farme 1')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('field_remove_button_farm2')
          .setLabel('Briši iz Farme 2')
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({
        content: 'Za koju farmu želiš obrisati polje?',
        components: buildFieldActionChoiceRows('remove'),
        ephemeral: true,
      });
    }

    // === FARMING: dugme za dodavanje polja (iz field-panel poruke) ===
    const fieldAddFarmKey = getFarmKeyFromCustomId(interaction.customId, 'field_add_button_');
    if (fieldAddFarmKey) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može dodavati polja.',
          ephemeral: true,
        });
      }

      const farm = getFarmConfig(fieldAddFarmKey);

      const modal = new ModalBuilder()
        .setCustomId(`field_add_modal_${farm.key}`)
        .setTitle(`Dodavanje novog polja – ${farm.label}`);

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

    const fieldUpdateFarmKey = getFarmKeyFromCustomId(interaction.customId, 'field_update_button_');
    if (fieldUpdateFarmKey) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff može uređivati polja.',
          ephemeral: true,
        });
      }

      const farm = getFarmConfig(fieldUpdateFarmKey);
      const modal = new ModalBuilder()
        .setCustomId(`update_field_modal_${farm.key}`)
        .setTitle(`Uredi polje - ${farm.label}`);

      const oldFieldInput = new TextInputBuilder()
        .setCustomId('old_field')
        .setLabel('Koje polje zelis urediti?')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const newFieldInput = new TextInputBuilder()
        .setCustomId('new_field')
        .setLabel('Novo ime polja')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(oldFieldInput),
        new ActionRowBuilder().addComponents(newFieldInput)
      );
      return interaction.showModal(modal);
    }

    const fieldRemoveFarmKey = getFarmKeyFromCustomId(interaction.customId, 'field_remove_button_');
    if (fieldRemoveFarmKey) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može brisati polja.',
          ephemeral: true,
        });
      }

      const farm = getFarmConfig(fieldRemoveFarmKey);
      const modal = new ModalBuilder()
        .setCustomId(`field_remove_modal_${farm.key}`)
        .setTitle(`Brisanje polja – ${farm.label}`);

      const input = new TextInputBuilder()
        .setCustomId('field_value')
        .setLabel('Koje polje želiš obrisati?')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // === FARMING: START KREIRANJA POSLA === 
const taskStartFarmKey = getFarmKeyFromCustomId(interaction.customId, 'task_start_');
if (taskStartFarmKey) {
  const farmKey = taskStartFarmKey;
  const farm = getFarmConfig(farmKey);
  activeTasks.set(interaction.user.id, { field: null, farmKey: farm.key });

  const FIELDS = getFarmingFields(farm.key);
  const rows = buildTaskFieldSelectionRows(FIELDS, farm.key);

  const embed = new EmbedBuilder()
    .setColor('#ffd900')
    .setTitle('🚜 Kreiranje zadatka – Korak 1')
    .setDescription(`${farm.label}\n\nOdaberi polje za koje želiš kreirati posao.`);

  await interaction.reply({
    embeds: [embed],
    components: rows,
    ephemeral: true,
  });
  return;
}


// === OPĆI ZADATAK: START (BEZ POLJA) ===
if (
  getFarmKeyFromCustomId(interaction.customId, 'task_general_start_')
) {
  const farmKey = getFarmKeyFromCustomId(interaction.customId, 'task_general_start_');
  const farm = getFarmConfig(farmKey);
  const modal = new ModalBuilder()
    .setCustomId(`task_general_modal_${farm.key}`)
    .setTitle(`📝 Novi zadatak – ${farm.label}`);

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
      const farm = getFarmConfig(current.farmKey || 'farm1');
      current.field = fieldId;
      current.transientMessageId = interaction.message?.id || current.transientMessageId;
      activeTasks.set(interaction.user.id, current);

      const embed = new EmbedBuilder()
        .setColor('#00a84d')
        .setTitle('🚜 Kreiranje zadatka – Korak 2')
        .setDescription(
          `${farm.label}\nOdabrano polje: **Polje ${fieldId}**\n\nSada odaberi vrstu posla:`
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
          .setLabel('Đubrenje')
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
          .setLabel('Košnja trave')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_kosnja_djeteline')
          .setLabel('Košnja djeteline')
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
          .setLabel('Malčiranje')
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
          .setLabel('Zamotati bale za silažu')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_zimska')
          .setLabel('Zimska brazda')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_ceste')
          .setLabel('Čišćenje ceste')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_rolanje')
          .setLabel('Rolanje polja')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('task_job_silaza')
          .setLabel('Silaža')
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
    content: '⚠️ Nije pronađeno polje.',
    ephemeral: true,
  });
}

const jobKey = interaction.customId.replace('task_job_', '');
const farm = getFarmConfig(current.farmKey || 'farm1');
const jobNames = {
  oranje: 'Oranje',
  lajn: 'Bacanje lajma',
  djubrenje: 'Đubrenje',
  tanjiranje: 'Kultiviranje',
  podrivanje: 'Podrivanje',
  herbicid: 'Prskanje herbicidom',
  kosnja_trave: 'Košnja trave',
  kosnja_djeteline: 'Košnja djeteline',
  malciranje: 'Malčiranje',
  spajanje: 'Spajanje polja',
  baliranje: 'Baliranje',
  skupljanje: 'Skupljanje u redove',
  okretanje: 'Prevrtanje trave / djeteline',
  zamotavanje: 'Zamotati bale za silažu',
  zimska: 'Zimska brazda',
  ceste: 'Čišćenje ceste',
  rolanje: 'Rolanje polja',
  silaza: 'Silaža',
};

current.jobKey = jobKey;
current.jobName = jobNames[jobKey] || jobKey;
activeTasks.set(interaction.user.id, current);


      // ⛔ OVDJE VIŠE NE KREIRAŠ ZADATAK

const embed = new EmbedBuilder()
  .setColor('#5865f2')
  .setTitle('🚦 Odaberi prioritet posla')
  .setDescription(
    `🏡 **Farma:** ${farm.label}\n` +
    `🚜 **Polje:** ${current.field}\n` +
    `🛠️ **Posao:** ${current.jobName}\n\n` +
    'Odaberi prioritet:'
  );

const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('task_priority_hitno')
    .setLabel('🔴 HITNO')
    .setStyle(ButtonStyle.Danger),
  new ButtonBuilder()
    .setCustomId('task_priority_visok')
    .setLabel('🟠 Visok')
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId('task_priority_srednji')
    .setLabel('🟡 Srednji')
    .setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId('task_priority_nizak')
    .setLabel('🟢 Nizak')
    .setStyle(ButtonStyle.Success)
);

// VAŽNO
return interaction.update({
  embeds: [embed],
  components: [row],
});

    }

// ==============================
// 3️⃣ PRIORITET → KREIRANJE POSLA
// ==============================
if (interaction.customId.startsWith('task_priority_')) {
  const current = activeTasks.get(interaction.user.id);
  if (!current) {
    return interaction.reply({
      content: '⚠️ Nema aktivnog zadatka.',
      ephemeral: true,
    });
  }

  const priorities = getTaskPriorities();

  const key = interaction.customId.replace('task_priority_', '');
  const prio = priorities[key];
  if (!prio) return;
  const farm = getFarmConfig(current.farmKey || 'farm1');

  // ==============================
  // 📝 OPĆI ZADATAK (BEZ POLJA)
  // ==============================
  if (current.type === 'general') {
    const embed = new EmbedBuilder()
      .setColor(prio.color)
      .setTitle(`${prio.label} – Zadatak`)
      .addFields(
        { name: 'Farma', value: farm.label, inline: true },
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
        .setLabel('✅ Završi zadatak')
        .setStyle(ButtonStyle.Success)
    );

    const jobChannel = await interaction.guild.channels.fetch(farm.jobChannelId);
    const sentMsg = await jobChannel.send({
      embeds: [embed],
      components: [row],
    });

    saveFarmingTask({
      farmKey: farm.key,
      farmLabel: farm.label,
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

    await interaction.update({
      content: '✅ Opći zadatak je kreiran.',
      embeds: [],
      components: [],
    });
    scheduleInteractionReplyDeletion(interaction, 1500);
    return;
  }

  // ==============================
  // 🚜 FARMING POSAO (POLJA)
  // ==============================
  if (!current.field || !current.jobName) {
    return interaction.reply({
      content: '⚠️ Nema aktivnog farming zadatka.',
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(prio.color)
    .setTitle(`${prio.label} – Novi zadatak`)
    .addFields(
      { name: 'Farma', value: farm.label, inline: true },
      { name: 'Polje', value: `Polje ${current.field}`, inline: true },
      { name: 'Posao', value: current.jobName, inline: true },
      ...(current.cropName
        ? [{ name: 'Kultura', value: current.cropName, inline: true }]
        : []),
      ...(current.harvestInfo
        ? [{ name: 'Detalji', value: current.harvestInfo, inline: true }]
        : []),
      { name: 'Izradio', value: `<@${interaction.user.id}>`, inline: true },
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('task_done')
      .setLabel('✅ Završi zadatak')
      .setStyle(ButtonStyle.Success)
  );

  saveFarmingTask({
    farmKey: farm.key,
    farmLabel: farm.label,
    field: current.field,
    taskId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    jobKey: current.jobKey,
    jobName: current.jobName,
    cropName: current.cropName,
    harvestInfo: current.harvestInfo,
    priority: key,
    priorityLabel: prio.label,
    priorityValue: prio.value,
    status: 'open',
    fromFs: false,
    channelId: farm.jobChannelId,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
  });

  if (current.jobKey === 'sijanje' && current.cropName) {
    await handleNewSowingTask(interaction.guild, current.field, current.cropName);
  }

  await updateFarmingTaskPanel(interaction.guild, farm.key).catch(() => null);

  activeTasks.delete(interaction.user.id);

  await interaction.update({
    content: '✅ Farming zadatak je uspješno kreiran.',
    embeds: [],
    components: [],
  });
  scheduleInteractionReplyDeletion(interaction, 1500);
  return;
}



    // === FARMING: Sijanje – otvaranje modala ===
    if (interaction.customId === 'task_job_sijanje') {
      const current = activeTasks.get(interaction.user.id);
      if (!current || !current.field) {
        await interaction.reply({
          content:
            '⚠️ Nije pronađeno polje. Pokušaj ponovno klikom na „Kreiraj posao“.',
          ephemeral: true,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('task_sowing_modal')
        .setTitle('Sijanje – unos kulture');

      const input = new TextInputBuilder()
        .setCustomId('seed_name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('npr. kukuruz, ječam...')
        .setRequired(true);

      const prioritySelect = new StringSelectMenuBuilder()
        .setCustomId('task_priority_select')
        .setPlaceholder('Odaberi prioritet')
        .addOptions(
          { label: 'HITNO', value: 'hitno', emoji: '🔴' },
          { label: 'Visok', value: 'visok', emoji: '🟠' },
          { label: 'Srednji', value: 'srednji', emoji: '🟡' },
          { label: 'Nizak', value: 'nizak', emoji: '🟢' }
        );

      modal.addComponents(
        new LabelBuilder()
          .setLabel('Što se sije? (npr. kukuruz, ječam...)')
          .setTextInputComponent(input),
        new LabelBuilder()
          .setLabel('Prioritet')
          .setStringSelectMenuComponent(prioritySelect)
      );

      await interaction.showModal(modal);
      return;
    }

    // === FARMING: Kombajniranje – otvaranje modala ===
    if (interaction.customId === 'task_job_kombajniranje_modal') {
      const current = activeTasks.get(interaction.user.id);
      if (!current || !current.field) {
        await interaction.reply({
          content:
            '⚠️ Nije pronađeno polje. Pokušaj ponovno klikom na „Kreiraj posao“.',
          ephemeral: true,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('task_harvest_modal')
        .setTitle('Kombajniranje – unos detalja');

      const input = new TextInputBuilder()
        .setCustomId('harvest_info')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('npr. pšenica, soja...')
        .setRequired(true);

      const prioritySelect = new StringSelectMenuBuilder()
        .setCustomId('task_priority_select')
        .setPlaceholder('Odaberi prioritet')
        .addOptions(
          { label: 'HITNO', value: 'hitno', emoji: '🔴' },
          { label: 'Visok', value: 'visok', emoji: '🟠' },
          { label: 'Srednji', value: 'srednji', emoji: '🟡' },
          { label: 'Nizak', value: 'nizak', emoji: '🟢' }
        );

      modal.addComponents(
        new LabelBuilder()
          .setLabel('Što se kombajnira? (npr. pšenica, soja...)')
          .setTextInputComponent(input),
        new LabelBuilder()
          .setLabel('Prioritet')
          .setStringSelectMenuComponent(prioritySelect)
      );

      await interaction.showModal(modal);
      return;
    }

    // === FARMING: označi zadatak kao završen ručno ===
if (interaction.customId === 'task_done') {
  const oldEmbed = interaction.message.embeds[0];

  if (!oldEmbed) {
    await interaction.reply({
      content: '⚠️ Ne mogu pronaći podatke o zadatku.',
      ephemeral: true,
    });
    return;
  }

  // 🔍 PRONAĐI ZADATAK U DB-u PO PORUKI
  const db = loadDb();
  const task = db.farmingTasks.find(t => t.messageId === interaction.message.id);
  const farm = resolveFarmConfig(task || { channelId: interaction.channelId });

  // 🌾 Ako je ovo bio zadatak SIJANJA → upis u sezonu
  if (task && task.jobKey === 'sijanje') {
    const cropName = task.cropName || task.jobName || "nepoznato";

    // 🔧 FIX – upiši cropName u DB ako nedostaje
if (!task.cropName) {
    task.cropName = cropName;
    saveDb(db);
}


    try {
    console.log("➡ Pokrećem ručni upis sjetve u sezonu...");
    await handleNewSowingTask(interaction.guild, task.field, cropName);
    console.log(`🌾 Ručno završavanje sjetve → Polje ${task.field}: ${cropName}`);

    // 🔥 PRISILNI REFRESH EMBEDA
    await updateSeasonEmbed(interaction.guild);
    console.log("🌾 Embed sezone ručno osvježen.");
} catch (err) {
    console.error("❌ Greška pri ručnom upisu sjetve:", err);
}

  }

  // 🔄 GENERIRAJ NOVI EMBED O ZAVRŠETKU
  const finishedEmbed = EmbedBuilder.from(oldEmbed)
    .setColor('#ff0000')
    .setTitle('✅ Zadatak završen')
    .setFooter({
      text: 'Označeno kao završeno od strane: ' + interaction.user.tag,
    })
    .setTimestamp();

  const doneChannel = await interaction.guild.channels.fetch(farm.doneChannelId);

  await doneChannel.send({ embeds: [finishedEmbed] });

  if (task) {
    task.status = 'done';
    task.channelId = doneChannel.id;
    task.farmKey = farm.key;
    task.farmLabel = farm.label;
    task.finishedBy = interaction.user.tag;
    task.finishedAt = new Date().toISOString();
    saveDb(db);
  }

  await updateFarmingTaskPanel(interaction.guild, farm.key).catch(() => null);

  await interaction.reply({
    content:
      '✅ Zadatak je označen kao završen i prebačen u kanal za završene poslove.',
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
          content: '⛔ Samo staff/admin može koristiti ovu opciju.',
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
          content: `✅ Ticket je preuzeo/la ${interaction.user}.`,
        });
        return;
      }

      if (interaction.customId === 'ticket_close') {
        await interaction.reply({
          content: '🔒 Ticket je zatvoren. Kanal je označen kao zatvoren.',
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
    if (interaction.customId === ANNOUNCEMENT_MODAL_ID) {
      if (!memberHasAnyRole(interaction.member, ANNOUNCEMENT_ALLOWED_ROLE_IDS)) {
        return interaction.reply({
          content: 'Nem as permisiju za slanje ove announcement poruke.',
          ephemeral: true,
        });
      }

      const title = interaction.fields.getTextInputValue('announcement_title').trim();
      const description = interaction.fields
        .getTextInputValue('announcement_description')
        .trim();
      const pendingRole = pendingAnnouncementRoles.get(interaction.user.id);
      const roleLine =
        pendingRole?.channelId === interaction.channelId && Array.isArray(pendingRole?.roleIds)
          ? pendingRole.roleIds.map((roleId) => `<@&${roleId}>`).join(' ')
          : '';

      pendingAnnouncementRoles.delete(interaction.user.id);

      await interaction.channel.send({
        content: [`**${title}**`, '', description].join('\n') + roleLine,
      });

      return interaction.reply({
        content: 'Announcement poruka je poslana u ovaj kanal.',
        ephemeral: true,
      });
    }

    if (await handlePollModal(interaction, client)) {
      return;
    }

    if (interaction.customId.startsWith('ban_panel_ban_modal:')) {
      if (!canManageDiscordBans(interaction.member)) {
        return interaction.reply({
          content: 'Nemas ovlast za ban preko ovog panela.',
          ephemeral: true,
        });
      }

      const targetInput = interaction.fields.getTextInputValue('ban_target_user');
      const reasonInput = normalizeDiscordText(
        interaction.fields.getTextInputValue('ban_target_reason')
      );
      const targetUserId = extractDiscordUserId(targetInput);

      if (!targetUserId) {
        return interaction.reply({
          content: 'Upisi ispravan Discord user ID ili mention.',
          ephemeral: true,
        });
      }

      const finalReason = reasonInput || `Ban preko ban panela od ${interaction.user.tag}`;

      try {
        await interaction.guild.members.ban(targetUserId, {
          reason: finalReason,
        });

        await updateDiscordBanPanel(interaction.guild, {
          selectedUserId: targetUserId,
        });

        return interaction.reply({
          content:
            `Korisnik <@${targetUserId}> je banan preko panela.` +
            (reasonInput ? `\nRazlog: ${reasonInput}` : ''),
          ephemeral: true,
        });
      } catch (error) {
        return interaction.reply({
          content: `Ban nije uspio: ${error.message}`,
          ephemeral: true,
        });
      }
    }

    if (
      interaction.customId === 'sowing_table_add_modal' ||
      interaction.customId === 'sowing_table_edit_modal' ||
      interaction.customId === 'sowing_table_years_modal' ||
      interaction.customId === 'sowing_table_delete_modal'
    ) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može uređivati tablicu sjetve.',
          ephemeral: true,
        });
      }

      const farmKey = resolveSowingTableFarmKey(interaction.channelId) || 'farm2';
      const state = getSowingTableState(farmKey);
      const rows = [...state.rows];

      if (interaction.customId === 'sowing_table_add_modal') {
        const field = interaction.fields.getTextInputValue('field').trim();
        if (!field) {
          return interaction.reply({
            content: '⚠️ Moraš upisati polje.',
            ephemeral: true,
          });
        }

        const exists = rows.some((row) => row.field.toLowerCase() === field.toLowerCase());
        if (exists) {
          return interaction.reply({
            content: `⚠️ Polje **${field}** već postoji u tablici.`,
            ephemeral: true,
          });
        }

        rows.push({
          field,
          year1: interaction.fields.getTextInputValue('year1').trim(),
          year2: interaction.fields.getTextInputValue('year2').trim(),
          year3: interaction.fields.getTextInputValue('year3').trim(),
          year4: interaction.fields.getTextInputValue('year4').trim(),
        });

        saveSowingTableState(farmKey, {
          ...state,
          rows,
        });
        await updateSowingTableMessage(interaction.guild, farmKey);
        await interaction.reply({
          content: `✅ Red za polje **${field}** je dodan u tablicu za ${getFarmConfig(farmKey).label}.`,
          ephemeral: true,
        });
        scheduleInteractionReplyDeletion(interaction, 1800);
        return;
      }

      if (interaction.customId === 'sowing_table_edit_modal') {
        const field = interaction.fields.getTextInputValue('field').trim();
        const index = rows.findIndex((row) => row.field.toLowerCase() === field.toLowerCase());

        if (index === -1) {
          return interaction.reply({
            content: `⚠️ Polje **${field}** nije pronađeno u tablici.`,
            ephemeral: true,
          });
        }

        rows[index] = {
          field: rows[index].field,
          year1: interaction.fields.getTextInputValue('year1').trim(),
          year2: interaction.fields.getTextInputValue('year2').trim(),
          year3: interaction.fields.getTextInputValue('year3').trim(),
          year4: interaction.fields.getTextInputValue('year4').trim(),
        };

        saveSowingTableState(farmKey, {
          ...state,
          rows,
        });
        await updateSowingTableMessage(interaction.guild, farmKey);
        await interaction.reply({
          content: `✅ Red za polje **${field}** je ažuriran za ${getFarmConfig(farmKey).label}.`,
          ephemeral: true,
        });
        scheduleInteractionReplyDeletion(interaction, 1800);
        return;
      }

      if (interaction.customId === 'sowing_table_years_modal') {
        const yearLabels = [1, 2, 3, 4].map((index) =>
          interaction.fields.getTextInputValue(`year_label_${index}`).trim() || `${index} GOD`
        );

        saveSowingTableState(farmKey, {
          ...state,
          yearLabels,
        });
        await updateSowingTableMessage(interaction.guild, farmKey);
        await interaction.reply({
          content: `✅ Nazivi stupaca su ažurirani za ${getFarmConfig(farmKey).label}.`,
          ephemeral: true,
        });
        scheduleInteractionReplyDeletion(interaction, 1800);
        return;
      }

      if (interaction.customId === 'sowing_table_delete_modal') {
        const field = interaction.fields.getTextInputValue('field').trim();
        const nextRows = rows.filter((row) => row.field.toLowerCase() !== field.toLowerCase());

        if (nextRows.length === rows.length) {
          return interaction.reply({
            content: `⚠️ Polje **${field}** nije pronađeno u tablici.`,
            ephemeral: true,
          });
        }

        saveSowingTableState(farmKey, {
          ...state,
          rows: nextRows,
        });
        await updateSowingTableMessage(interaction.guild, farmKey);
        await interaction.reply({
          content: `🗑️ Red za polje **${field}** je obrisan iz ${getFarmConfig(farmKey).label}.`,
          ephemeral: true,
        });
        scheduleInteractionReplyDeletion(interaction, 1800);
        return;
      }
    }

    if (interaction.customId.startsWith('ticket_answers:')) {
      await refreshSharedBotConfigFromMySql(true);
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
            '⛔ Ne mozes zavrsiti otvaranje ticketa jer si na ticket blackliste.' +
            (blacklistEntry.reason ? `\nRazlog: ${blacklistEntry.reason}` : ''),
          ephemeral: true,
        });
      }

      if (!typeCfg || !state || state.type !== type) {
        return interaction.reply({
          content: '⚠️ Ticket forma je istekla. Otvori ticket ponovno iz panela.',
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
        ? [{ question: 'Koliko imaš godina?', answer: String(age) }, ...questionAnswers]
        : questionAnswers;
      const submissionAnswersText = requiresAge
        ? [`Koliko imaš godina?\n${age}`, ...questionAnswers.map((entry, index) => `${index + 1}. ${entry.question}\n${entry.answer}`)].join('\n\n')
        : answersBlob;

      if (requiresAge && (!Number.isInteger(age) || age <= 0)) {
        return interaction.reply({
          content: '⚠️ Polje za godine mora sadržavati ispravan broj.',
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
          content: '❌ Tvoja prijava je odbijena radi maloljetnosti. Minimalna dob za ovaj ticket je 18 godina.',
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
    const fieldAddModalFarmKey = getFarmKeyFromCustomId(interaction.customId, 'field_add_modal_');
    if (fieldAddModalFarmKey) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može dodavati polja.',
          ephemeral: true,
        });
      }

      const farm = getFarmConfig(fieldAddModalFarmKey);
      const value = interaction.fields.getTextInputValue('field_value').trim();

      if (!value) {
        return interaction.reply({
          content: '⚠️ Moraš upisati oznaku polja.',
          ephemeral: true,
        });
      }

      const fields = getFarmingFields(farm.key);
      if (fields.includes(value)) {
        return interaction.reply({
          content: `⚠️ Polje **${value}** već postoji u listi za ${farm.label}.`,
          ephemeral: true,
        });
      }

      fields.push(value);
      saveFarmingFields(farm.key, fields);
      await updateFarmingFieldsEmbed(interaction.guild);

      return interaction.reply({
        content: `✅ Polje **${value}** je dodano u listu za ${farm.label}.`,
        ephemeral: true,
      });
    }

    const fieldRemoveModalFarmKey = getFarmKeyFromCustomId(interaction.customId, 'field_remove_modal_');
    if (fieldRemoveModalFarmKey) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
          content: '⛔ Samo staff/admin može brisati polja.',
          ephemeral: true,
        });
      }

      const farm = getFarmConfig(fieldRemoveModalFarmKey);
      const value = interaction.fields.getTextInputValue('field_value').trim();
      const fields = getFarmingFields(farm.key);
      const index = fields.indexOf(value);

      if (index === -1) {
        return interaction.reply({
          content: `⚠️ Polje **${value}** nije pronađeno u listi za ${farm.label}.`,
          ephemeral: true,
        });
      }

      fields.splice(index, 1);
      saveFarmingFields(farm.key, fields);
      await updateFarmingFieldsEmbed(interaction.guild);

      return interaction.reply({
        content: `🗑️ Polje **${value}** je uklonjeno iz liste za ${farm.label}.`,
        ephemeral: true,
      });
    }

    // 📝 OPĆI ZADATAK – MODAL SUBMIT → PRIORITET
if (
  getFarmKeyFromCustomId(interaction.customId, 'task_general_modal_')
) {
  const title = interaction.fields.getTextInputValue('task_title');
  const description =
    interaction.fields.getTextInputValue('task_description') || '';
  const farmKey = getFarmKeyFromCustomId(interaction.customId, 'task_general_modal_');

  activeTasks.set(interaction.user.id, {
    type: 'general',
    farmKey,
    title,
    description,
  });

  const farm = getFarmConfig(farmKey);

  const embed = new EmbedBuilder()
    .setColor('#5865f2')
    .setTitle('🚦 Odaberi prioritet')
    .setDescription(
      `🏡 **Farma:** ${farm.label}\n` +
      `📝 **Zadatak:** ${title}\n` +
      (description ? `📄 ${description}\n\n` : '\n') +
      'Odaberi prioritet:'
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('task_priority_hitno')
      .setLabel('🔴 HITNO')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('task_priority_visok')
      .setLabel('🟠 Visok')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('task_priority_srednji')
      .setLabel('🟡 Srednji')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('task_priority_nizak')
      .setLabel('🟢 Nizak')
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
            '⚠️ Ne mogu pronaći odabrano polje. Pokušaj ponovno od početka.',
          ephemeral: true,
        });
        return;
      }

      current.transientMessageId = interaction.message?.id || current.transientMessageId;
      activeTasks.set(interaction.user.id, current);

      const seedName = interaction.fields.getTextInputValue('seed_name');
      const priorityKey =
        interaction.fields.getStringSelectValues('task_priority_select')?.[0];
      const priorities = getTaskPriorities();
      const prio = priorities[priorityKey];
      const farm = getFarmConfig(current.farmKey || 'farm1');
      if (!prio) {
        return interaction.reply({
          content: '⚠️ Moraš odabrati prioritet.',
          ephemeral: true,
        });
      }

      saveFarmingTask({
        taskId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        farmKey: farm.key,
        farmLabel: farm.label,
        field: current.field,
        jobKey: 'sijanje',
        jobName: 'Sijanje',
        cropName: seedName,
        priority: priorityKey,
        priorityLabel: prio.label,
        priorityValue: prio.value,
        status: 'open',
        fromFs: false,
        channelId: farm.jobChannelId,
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
      });

      await handleNewSowingTask(interaction.guild, current.field, seedName);
      await updateFarmingTaskPanel(interaction.guild, farm.key).catch(() => null);
      await cleanupTransientTaskMessage(interaction, current);
      activeTasks.delete(interaction.user.id);

      await interaction.reply({
        content: `✅ Zadatak za sijanje je kreiran s prioritetom ${prio.label}.`,
        ephemeral: true,
      });
      scheduleInteractionReplyDeletion(interaction);
      return;
    }

    // === UPDATE FIELD – STEP 2 (kompletan rename sistema) ===
if (
    getFarmKeyFromCustomId(interaction.customId, 'update_field_modal_')
) {
    const farmKey = getFarmKeyFromCustomId(interaction.customId, 'update_field_modal_');
    const farm = getFarmConfig(farmKey);
    const oldField = interaction.fields.getTextInputValue("old_field").trim();
    const newField = interaction.fields.getTextInputValue("new_field").trim();

    // === 1) Učitaj listu polja
    const fields = getFarmingFields(farm.key);
    const index = fields.indexOf(oldField);

    if (index === -1) {
        return interaction.reply({
            content: `❌ Greška: polje **${oldField}** više ne postoji.`,
            ephemeral: true,
        });
    }

    if (fields.includes(newField)) {
        return interaction.reply({
            content: `⚠️ Polje **${newField}** već postoji.`,
            ephemeral: true,
        });
    }

    // zamijeni u listi polja
    fields[index] = newField;
    saveFarmingFields(farm.key, fields);
    await updateFarmingFieldsEmbed(interaction.guild);

    // === 2) Učitaj DB jer mijenjamo još stvari
    const db = loadDb();

    // === 3) Update u svim farmingTasks
    for (const t of db.farmingTasks) {
        if (t.field === oldField && resolveFarmConfig(t).key === farm.key) {
            t.field = newField;
        }
    }

    // odmah spremi
    saveDb(db);


    // === 4) Update embed poruka zadataka (aktivni + završeni)
    async function updateTaskEmbeds() {
        const guild = interaction.guild;

        // aktivni channel
        const allTasks = db.farmingTasks.filter(
          (t) => t.field === newField && resolveFarmConfig(t).key === farm.key
        );

        for (const t of allTasks) {
            const taskFarm = resolveFarmConfig(t);
            const channelId =
              t.status === "open" ? taskFarm.jobChannelId : taskFarm.doneChannelId;
            const ch = await guild.channels.fetch(channelId).catch(() => null);
            if (!ch) continue;

            const msg = await ch.messages.fetch(t.messageId).catch(() => null);
            if (!msg || !msg.embeds[0]) continue;

            let embed = EmbedBuilder.from(msg.embeds[0]);

            // Regex: zamjenjuje bilo koji oblik "Polje ... oldField"
            const regex = new RegExp(`Polje\\s*[:\\-]*\\s*${oldField}`, "i");

            embed = embed.toJSON(); // lakše manipulirati

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
    await updateFarmingTaskPanel(interaction.guild, farm.key).catch(() => null);


    // === 5) Update Sowing Season (mora promijeniti ključ)
    const seasons = getSowingSeasons();
    for (const season of seasons) {
        if (season.fields && season.fields[oldField]) {
            season.fields[newField] = season.fields[oldField];
            delete season.fields[oldField];
        }
    }
    saveSowingSeasons(seasons);


    // === 6) Refresh živog embed-a sezone
    try {
        await updateSeasonEmbed(interaction.guild);
    } catch (e) {
        console.log("Greška refresh sezone:", e);
    }


    return interaction.reply({
        content: `✅ Polje **${oldField}** je uspješno preimenovano u **${newField}** za ${farm.label}.\n\nSve poruke, zadaci i sezona su ažurirani.`,
        ephemeral: true,
    });
}



    // Kombajniranje
    if (interaction.customId === 'task_harvest_modal') {
      const current = activeTasks.get(interaction.user.id);
      if (!current || !current.field) {
        await interaction.reply({
          content:
            '⚠️ Ne mogu pronaći odabrano polje. Pokušaj ponovno od početka.',
          ephemeral: true,
        });
        return;
      }

      current.transientMessageId = interaction.message?.id || current.transientMessageId;
      activeTasks.set(interaction.user.id, current);

      const harvestInfo = interaction.fields.getTextInputValue('harvest_info');
      const priorityKey =
        interaction.fields.getStringSelectValues('task_priority_select')?.[0];
      const priorities = getTaskPriorities();
      const prio = priorities[priorityKey];
      const farm = getFarmConfig(current.farmKey || 'farm1');
      if (!prio) {
        return interaction.reply({
          content: '⚠️ Moraš odabrati prioritet.',
          ephemeral: true,
        });
      }

      saveFarmingTask({
        taskId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        farmKey: farm.key,
        farmLabel: farm.label,
        field: current.field,
        jobKey: 'kombajniranje',
        jobName: 'Kombajniranje',
        harvestInfo,
        priority: priorityKey,
        priorityLabel: prio.label,
        priorityValue: prio.value,
        status: 'open',
        fromFs: false,
        channelId: farm.jobChannelId,
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
      });

      await updateFarmingTaskPanel(interaction.guild, farm.key).catch(() => null);
      await cleanupTransientTaskMessage(interaction, current);
      activeTasks.delete(interaction.user.id);

      await interaction.reply({
        content: `✅ Zadatak za kombajniranje je kreiran s prioritetom ${prio.label}.`,
        ephemeral: true,
      });
      scheduleInteractionReplyDeletion(interaction);
      return;
    }
  }
});

client.login(token).catch((err) => {
  console.error('❌ Login error:', err);
  
});
