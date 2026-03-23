const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const POLL_PANEL_CHANNEL_ID = '1485686826558816296';
const POLL_DURATION_MS = 24 * 60 * 60 * 1000;
const POLL_PANEL_BUTTON_ID = 'poll_panel_create';
const POLL_BUTTON_PREFIX = 'anketa_vote:';

const MAP_OPTIONS = [
  {
    key: 'balkanska_dolina',
    name: 'Balkanska Dolina',
    description: [
      'Mala polja, brda i guste sume.',
      'Idealna za roleplay gameplay i timsku koordinaciju.',
      'Dobra za opusteniji tempo rada i detaljniju farmu.',
    ],
    players: '4-8 igraca',
    buttonStyle: ButtonStyle.Success,
    accentColor: 0x2b9348,
    images: [
      'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1500595046743-cd271d694d30?auto=format&fit=crop&w=1600&q=80',
    ],
  },
  {
    key: 'midwest_usa',
    name: 'Midwest USA',
    description: [
      'Velika ravna polja sa sirokom preglednoscu.',
      'Napravljen za gameplay sa velikim masinama.',
      'Odlican izbor za brzu i efikasnu organizaciju farme.',
    ],
    players: '6-12 igraca',
    buttonStyle: ButtonStyle.Primary,
    accentColor: 0xd97706,
    images: [
      'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1464226184884-fa280b87c399?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1500076656116-558758c991c1?auto=format&fit=crop&w=1600&q=80',
    ],
  },
];

const activePolls = new Map();

function buildPollPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xfacc15)
    .setTitle('📊 Ankete')
    .setDescription(
      'Ovdje mozes kreirati anketu za modove, mape i slicne server odluke.'
    );
}

function buildPollPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(POLL_PANEL_BUTTON_ID)
      .setLabel('Kreiraj anketu')
      .setStyle(ButtonStyle.Success)
  );
}

function getVoteTotals(votes) {
  const totals = Object.fromEntries(MAP_OPTIONS.map((map) => [map.key, 0]));

  for (const selectedMap of votes.values()) {
    if (typeof totals[selectedMap] === 'number') {
      totals[selectedMap] += 1;
    }
  }

  return totals;
}

function formatDiscordRelativeTime(timestampMs) {
  return `<t:${Math.floor(timestampMs / 1000)}:R>`;
}

function buildPollButtons({ disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    ...MAP_OPTIONS.map((map) =>
      new ButtonBuilder()
        .setCustomId(`${POLL_BUTTON_PREFIX}${map.key}`)
        .setLabel(map.name)
        .setStyle(map.buttonStyle)
        .setDisabled(disabled)
    )
  );
}

function buildPollEmbed(poll) {
  const totals = getVoteTotals(poll.votes);
  const totalVotes = poll.votes.size;
  const isClosed = poll.closed || Date.now() >= poll.endsAt;

  const embed = new EmbedBuilder()
    .setColor(isClosed ? 0x6b7280 : 0x84cc16)
    .setTitle('GLASANJE')
    .setDescription(
      [
        'Odaberite mapu za sljedecu Farming Simulator 25 multiplayer sesiju.',
        isClosed
          ? 'Anketa je zavrsena. Finalni rezultati ostaju vidljivi ispod.'
          : `Glasanje je aktivno jos ${formatDiscordRelativeTime(poll.endsAt)}.`,
      ].join('\n\n')
    )
    .addFields(
      ...MAP_OPTIONS.map((map) => ({
        name: map.name,
        value: [
          ...map.description.map((line) => `- ${line}`),
          `- Preporuceno: ${map.players}`,
          `- Trenutno glasova: **${totals[map.key]}**`,
        ].join('\n'),
        inline: false,
      })),
      {
        name: 'Rezultati',
        value: MAP_OPTIONS.map(
          (map) => `${map.name} - ${totals[map.key]} glasova`
        ).join('\n'),
        inline: false,
      }
    )
    .setFooter({
      text: `Ukupno glasova: ${totalVotes} | Jedan korisnik moze imati samo jedan aktivan glas`,
    })
    .setTimestamp();

  return embed;
}

function buildMapImagePayloads() {
  return MAP_OPTIONS.map((map) => ({
    content: `**${map.name} - pregled mape**`,
    embeds: map.images.map((imageUrl, index) =>
      new EmbedBuilder()
        .setColor(map.accentColor)
        .setTitle(index === 0 ? map.name : `${map.name} - kadar ${index + 1}`)
        .setDescription(
          index === 0
            ? `${map.players} | ${map.description[0]}`
            : 'Vizualni pregled mape za glasanje.'
        )
        .setImage(imageUrl)
    ),
  }));
}

async function finalizePoll(client, messageId) {
  const poll = activePolls.get(messageId);
  if (!poll || poll.closed) {
    return;
  }

  poll.closed = true;

  if (poll.timeout) {
    clearTimeout(poll.timeout);
    poll.timeout = null;
  }

  try {
    const channel = await client.channels.fetch(poll.channelId);
    if (!channel || !channel.isTextBased()) {
      return;
    }

    const message = await channel.messages.fetch(messageId);
    await message.edit({
      embeds: [buildPollEmbed(poll)],
      components: [buildPollButtons({ disabled: true })],
    });
  } catch (error) {
    console.error('ANKETA FINALIZE ERROR:', error);
  }
}

function schedulePollEnd(client, poll) {
  const remainingMs = Math.max(poll.endsAt - Date.now(), 0);
  poll.timeout = setTimeout(() => {
    finalizePoll(client, poll.messageId).catch((error) => {
      console.error('ANKETA TIMER ERROR:', error);
    });
  }, remainingMs);
}

async function createMapPoll(interaction, client) {
  // Jedan timestamp koristimo i za prikaz i za automatsko zatvaranje ankete.
  const endsAt = Date.now() + POLL_DURATION_MS;

  const pollMessage = await interaction.channel.send({
    embeds: [
      buildPollEmbed({
        votes: new Map(),
        endsAt,
        closed: false,
      }),
    ],
    components: [buildPollButtons()],
  });

  for (const payload of buildMapImagePayloads()) {
    await interaction.channel.send(payload);
  }

  const poll = {
    messageId: pollMessage.id,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    createdBy: interaction.user.id,
    votes: new Map(),
    endsAt,
    closed: false,
    timeout: null,
  };

  activePolls.set(pollMessage.id, poll);
  schedulePollEnd(client, poll);

  return pollMessage;
}

async function postPollPanel(interaction, client) {
  const channel = await client.channels.fetch(POLL_PANEL_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error(`Poll panel channel ${POLL_PANEL_CHANNEL_ID} nije dostupan.`);
  }

  await channel.send({
    embeds: [buildPollPanelEmbed()],
    components: [buildPollPanelRow()],
  });
}

async function handlePollVote(interaction, client) {
  if (interaction.isButton() && interaction.customId === POLL_PANEL_BUTTON_ID) {
    await interaction.reply({
      content: 'Primjer panela je postavljen. Funkcija za kreiranje ankete ide u sljedecem koraku.',
      ephemeral: true,
    });
    return true;
  }

  if (!interaction.isButton() || !interaction.customId.startsWith(POLL_BUTTON_PREFIX)) {
    return false;
  }

  const poll = activePolls.get(interaction.message.id);
  if (!poll) {
    await interaction.reply({
      content: 'Ova anketa vise nije aktivna ili je restart bota ocistio stanje iz memorije.',
      ephemeral: true,
    });
    return true;
  }

  if (poll.closed || Date.now() >= poll.endsAt) {
    await finalizePoll(client, poll.messageId);
    await interaction.reply({
      content: 'Anketa je zavrsena. Dugmad su iskljucena, a finalni rezultati su ostali prikazani.',
      ephemeral: true,
    });
    return true;
  }

  const selectedMapKey = interaction.customId.slice(POLL_BUTTON_PREFIX.length);
  const selectedMap = MAP_OPTIONS.find((map) => map.key === selectedMapKey);

  if (!selectedMap) {
    await interaction.reply({
      content: 'Odabrana opcija nije prepoznata.',
      ephemeral: true,
    });
    return true;
  }

  const previousVote = poll.votes.get(interaction.user.id);
  poll.votes.set(interaction.user.id, selectedMap.key);

  // Svaki klik odmah osvjezava glavni embed kako bi rezultati ostali live.
  await interaction.update({
    embeds: [buildPollEmbed(poll)],
    components: [buildPollButtons()],
  });

  await interaction.followUp({
    content:
      previousVote && previousVote !== selectedMap.key
        ? `Tvoj glas je prebacen na **${selectedMap.name}**.`
        : previousVote === selectedMap.key
          ? `Tvoj glas za **${selectedMap.name}** je vec zabiljezen.`
          : `Tvoj glas za **${selectedMap.name}** je uspjesno zabiljezen.`,
    ephemeral: true,
  });

  return true;
}

module.exports = {
  createMapPoll,
  postPollPanel,
  handlePollVote,
};
