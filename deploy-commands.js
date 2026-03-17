const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = require('./commands');

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Registrujem komande...');
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    console.log('Sve komande su registrirane.');
  } catch (error) {
    console.error(error);
  }
})();
