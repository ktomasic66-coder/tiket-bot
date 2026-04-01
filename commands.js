const { SlashCommandBuilder } = require('discord.js');

const addFarmOption = (option) =>
  option
    .setName('farm')
    .setDescription('Odaberi farmu')
    .setRequired(true)
    .addChoices(
      { name: 'Farma 1', value: 'farm1' },
      { name: 'Farma 2', value: 'farm2' }
    );

const commands = [
  new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Posalji ticket panel u ovaj kanal.'),

  new SlashCommandBuilder()
    .setName('task1')
    .setDescription('Postavi Farming Simulator 25 panel za Farmu 1 u ovaj kanal.'),

  new SlashCommandBuilder()
    .setName('task2')
    .setDescription('Postavi Farming Simulator 25 panel za Farmu 2 u ovaj kanal.'),

  new SlashCommandBuilder()
    .setName('anketa')
    .setDescription('Pokreni glasanje za FS25 mapu u ovom kanalu.'),

  new SlashCommandBuilder()
    .setName('modal')
    .setDescription('Otvori announcement modal i posalji poruku u ovaj kanal.')
    .addRoleOption((opt) =>
      opt
        .setName('uloga')
        .setDescription('Opcionalna uloga koja ce biti navedena na dnu poruke')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('add-field')
    .setDescription('Dodaj novo polje u listu za Farming zadatke.')
    .addStringOption(addFarmOption)
    .addStringOption((opt) =>
      opt
        .setName('value')
        .setDescription('Oznaka polja (npr. 56-276)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('remove-field')
    .setDescription('Ukloni polje iz liste za Farming zadatke.')
    .addStringOption(addFarmOption)
    .addStringOption((opt) =>
      opt
        .setName('value')
        .setDescription('Oznaka polja koju zelis ukloniti (npr. 56-276)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('update-field')
    .setDescription('Uredi postojece polje (prvo uneses staro polje, zatim novo ime polja).')
    .addStringOption(addFarmOption),

  new SlashCommandBuilder()
    .setName('reset-season')
    .setDescription('Resetira aktivnu sezonu sjetve.'),

  new SlashCommandBuilder()
    .setName('list-fields')
    .setDescription('Prikazi sva polja dostupna za odabranu farmu.')
    .addStringOption(addFarmOption),

  new SlashCommandBuilder()
    .setName('field-panel')
    .setDescription('Posalji panel za upravljanje poljima (dodavanje polja) u ovaj kanal.')
    .addStringOption(addFarmOption),

  new SlashCommandBuilder()
    .setName('blacklist')
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
    .setName('unblacklist')
    .setDescription('Makni korisnika s blackliste za otvaranje ticketa.')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Korisnik kojeg zelis maknuti s blackliste')
        .setRequired(true)
    ),
];

module.exports = commands.map((cmd) => cmd.toJSON());
