const { SlashCommandBuilder } = require('discord.js');

const addFarmOption = (option) =>
  option
    .setName('farm')
    .setDescription('Odaberi farmu')
    .setRequired(true)
    .addChoices(
      { name: 'Farma 1', value: 'farm1' },
      { name: 'Farma 2', value: 'farm2' },
      { name: 'Farma 3', value: 'farm3' }
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
    .setName('task3')
    .setDescription('Postavi Farming Simulator 25 panel za Farmu 3 u ovaj kanal.'),

  new SlashCommandBuilder()
    .setName('anketa')
    .setDescription('Pokreni glasanje za FS25 mapu u ovom kanalu.'),

  new SlashCommandBuilder()
    .setName('modal')
    .setDescription('Otvori announcement modal i posalji poruku u ovaj kanal.')
    .addRoleOption((opt) =>
      opt
        .setName('uloga1')
        .setDescription('Obavezna uloga koja ce biti navedena na dnu poruke')
        .setRequired(true)
    )
    .addRoleOption((opt) =>
      opt
        .setName('uloga2')
        .setDescription('Opcionalna druga uloga koja ce biti navedena na dnu poruke')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('add-field')
    .setDescription('Pokreni dodavanje novog polja u listu za Farming zadatke.'),

  new SlashCommandBuilder()
    .setName('remove-field')
    .setDescription('Pokreni brisanje polja iz liste za Farming zadatke.'),

  new SlashCommandBuilder()
    .setName('update-field')
    .setDescription('Pokreni uredivanje postojeceg polja.'),

  new SlashCommandBuilder()
    .setName('reset-season')
    .setDescription('Resetira aktivnu sezonu sjetve.'),

  new SlashCommandBuilder()
    .setName('list-fields')
    .setDescription('Prikazi sva polja dostupna za odabranu farmu.')
    .addStringOption(addFarmOption),

  new SlashCommandBuilder()
    .setName('field-panel')
    .setDescription('Posalji zajednicki panel za upravljanje poljima u kanal za polja.'),

  new SlashCommandBuilder()
    .setName('tablica')
    .setDescription('Postavi ili osvjezi zivu tablicu sjetve u ovom kanalu.'),

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
