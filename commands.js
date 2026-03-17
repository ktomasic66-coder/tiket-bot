const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Posalji ticket panel u ovaj kanal.'),

  new SlashCommandBuilder()
    .setName('task-panel')
    .setDescription('Postavi Farming Simulator 25 panel za kreiranje zadataka u ovaj kanal.'),

  new SlashCommandBuilder()
    .setName('add-field')
    .setDescription('Dodaj novo polje u listu za Farming zadatke.')
    .addStringOption((opt) =>
      opt
        .setName('value')
        .setDescription('Oznaka polja (npr. 56-276)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('remove-field')
    .setDescription('Ukloni polje iz liste za Farming zadatke.')
    .addStringOption((opt) =>
      opt
        .setName('value')
        .setDescription('Oznaka polja koju zelis ukloniti (npr. 56-276)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('update-field')
    .setDescription('Uredi postojece polje (prvo uneses staro polje, zatim novo ime polja).'),

  new SlashCommandBuilder()
    .setName('reset-season')
    .setDescription('Resetira aktivnu sezonu sjetve.'),

  new SlashCommandBuilder()
    .setName('list-fields')
    .setDescription('Prikazi sva polja dostupna u task-panelu.'),

  new SlashCommandBuilder()
    .setName('field-panel')
    .setDescription('Posalji panel za upravljanje poljima (dodavanje polja) u ovaj kanal.'),

  new SlashCommandBuilder()
    .setName('ticket-blacklist')
    .setDescription('Dodaj korisnika na blacklistu za otvaranje ticketa.')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Korisnik kojeg zelis blokirati za otvaranje ticketa')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('reason')
        .setDescription('Razlog blacklistanja')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('ticket-unblacklist')
    .setDescription('Makni korisnika s blackliste za otvaranje ticketa.')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Korisnik kojeg zelis maknuti s blackliste')
        .setRequired(true)
    ),
];

module.exports = commands.map((cmd) => cmd.toJSON());
