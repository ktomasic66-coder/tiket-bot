const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const commands = [
  // ticket panel
  new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Pošalji ticket panel u ovaj kanal.'),

  // farming task panel
  new SlashCommandBuilder()
    .setName('task-panel')
    .setDescription('Postavi Farming Simulator 25 panel za kreiranje zadataka u ovaj kanal.'),

  // ➕ dodaj novo polje u listu
  new SlashCommandBuilder()
    .setName('add-field')
    .setDescription('Dodaj novo polje u listu za Farming zadatke.')
    .addStringOption(opt =>
      opt
        .setName('value')
        .setDescription('Oznaka polja (npr. 56-276)')
        .setRequired(true)
    ),

  // 🗑️ ukloni polje iz liste
  new SlashCommandBuilder()
    .setName('remove-field')
    .setDescription('Ukloni polje iz liste za Farming zadatke.')
    .addStringOption(opt =>
      opt
        .setName('value')
        .setDescription('Oznaka polja koju želiš ukloniti (npr. 56-276)')
        .setRequired(true)
    ),

  // ✏️ Uredi postojeće polje
  new SlashCommandBuilder()
    .setName('update-field')
    .setDescription('Uredi postojeće polje (prvo uneseš staro polje, zatim novo ime polja).'),

  // 🌾 resetira sezonu sjetve (briše posijana polja, embed ostaje)
  new SlashCommandBuilder()
    .setName('reset-season')
    .setDescription('Resetira aktivnu sezonu sjetve.'),

  // 📋 lista polja
  new SlashCommandBuilder()
    .setName('list-fields')
    .setDescription('Prikaži sva polja dostupna u task-panelu.'),

  // 🧑‍🌾 panel za dodavanje polja
  new SlashCommandBuilder()
    .setName('field-panel')
    .setDescription('Pošalji panel za upravljanje poljima (dodavanje polja) u ovaj kanal.'),
  new SlashCommandBuilder()
    .setName('ticket-blacklist')
    .setDescription('Dodaj korisnika na blacklistu za otvaranje ticketa.')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Korisnik kojeg zelis blokirati za otvaranje ticketa')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('reason')
        .setDescription('Razlog blacklistanja')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('ticket-unblacklist')
    .setDescription('Makni korisnika s blackliste za otvaranje ticketa.')
    .addUserOption(opt =>
      opt
        .setName('user')
        .setDescription('Korisnik kojeg zelis maknuti s blackliste')
        .setRequired(true)
    ),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('📨 Registrujem komande...');
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    );
    console.log('✅ Sve komande su registrirane uključujući /update-field.');
  } catch (error) {
    console.error(error);
  }
})();
