const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const POLL_PANEL_CHANNEL_ID = '1485686826558816296';
const POLL_DURATION_MS = 24 * 60 * 60 * 1000;
const POLL_PANEL_BUTTON_ID = 'poll_panel_create';
const POLL_CREATE_MODAL_ID = 'poll_create_modal';
const POLL_BUTTON_PREFIX = 'anketa_vote:';

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

function buildPollCreateModal() {
  const titleInput = new TextInputBuilder()
    .setCustomId('poll_title')
    .setLabel('Naslov ankete')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80)
    .setPlaceholder('npr. Koju mapu vozimo ovaj vikend?');

  const descriptionInput = new TextInputBuilder()
    .setCustomId('poll_description')
    .setLabel('Opis ankete')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(300)
    .setPlaceholder('Kratko objasni sta se bira i do kada traje glasanje.');

  const optionOneInput = new TextInputBuilder()
    .setCustomId('poll_option_1')
    .setLabel('Opcija 1')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80)
    .setPlaceholder('npr. Balkanska Dolina');

  const optionTwoInput = new TextInputBuilder()
    .setCustomId('poll_option_2')
    .setLabel('Opcija 2')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80)
    .setPlaceholder('npr. Midwest USA');

  const optionThreeInput = new TextInputBuilder()
    .setCustomId('poll_option_3')
    .setLabel('Opcija 3 (opcionalno)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(80)
    .setPlaceholder('npr. Novi mod pack');

  return new ModalBuilder()
    .setCustomId(POLL_CREATE_MODAL_ID)
    .setTitle('Kreiranje ankete')
    .addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(optionOneInput),
      new ActionRowBuilder().addComponents(optionTwoInput),
      new ActionRowBuilder().addComponents(optionThreeInput)
    );
}

function formatDiscordRelativeTime(timestampMs) {
  return `<t:${Math.floor(timestampMs / 1000)}:R>`;
}

function buildButtonStyle(index) {
  const styles = [
    ButtonStyle.Success,
    ButtonStyle.Primary,
    ButtonStyle.Secondary,
    ButtonStyle.Danger,
  ];

  return styles[index] || ButtonStyle.Secondary;
}

function getVoteTotals(poll) {
  const totals = Object.fromEntries(poll.options.map((option) => [option.id, 0]));

  for (const selectedOptionId of poll.votes.values()) {
    if (typeof totals[selectedOptionId] === 'number') {
      totals[selectedOptionId] += 1;
    }
  }

  return totals;
}

function buildPollButtons(poll, { disabled = false } = {}) {
  const row = new ActionRowBuilder();

  for (const option of poll.options) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${POLL_BUTTON_PREFIX}${option.id}`)
        .setLabel(option.label)
        .setStyle(option.style)
        .setDisabled(disabled)
    );
  }

  return row;
}

function buildPollEmbed(poll) {
  const totals = getVoteTotals(poll);
  const totalVotes = poll.votes.size;
  const isClosed = poll.closed || Date.now() >= poll.endsAt;

  return new EmbedBuilder()
    .setColor(isClosed ? 0x6b7280 : 0x84cc16)
    .setTitle('GLASANJE')
    .setDescription(
      [
        `**${poll.title}**`,
        poll.description,
        isClosed
          ? 'Anketa je zavrsena. Finalni rezultati ostaju vidljivi ispod.'
          : `Glasanje je aktivno jos ${formatDiscordRelativeTime(poll.endsAt)}.`,
      ].join('\n\n')
    )
    .addFields(
      ...poll.options.map((option) => ({
        name: option.label,
        value: `${totals[option.id]} glasova`,
        inline: false,
      })),
      {
        name: 'Rezultati',
        value: poll.options
          .map((option) => `${option.label} - ${totals[option.id]} glasova`)
          .join('\n'),
        inline: false,
      }
    )
    .setFooter({
      text: `Ukupno glasova: ${totalVotes} | Jedan korisnik moze imati samo jedan aktivan glas`,
    })
    .setTimestamp();
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
      components: [buildPollButtons(poll, { disabled: true })],
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

function buildPollFromModal(interaction) {
  const title = interaction.fields.getTextInputValue('poll_title').trim();
  const description = interaction.fields.getTextInputValue('poll_description').trim();
  const optionLabels = [
    interaction.fields.getTextInputValue('poll_option_1').trim(),
    interaction.fields.getTextInputValue('poll_option_2').trim(),
    interaction.fields.getTextInputValue('poll_option_3').trim(),
  ].filter(Boolean);

  const uniqueLabels = [...new Set(optionLabels.map((label) => label.toLowerCase()))];
  if (uniqueLabels.length !== optionLabels.length) {
    return null;
  }

  const endsAt = Date.now() + POLL_DURATION_MS;

  return {
    title,
    description,
    options: optionLabels.map((label, index) => ({
      id: `option_${index + 1}`,
      label,
      style: buildButtonStyle(index),
    })),
    votes: new Map(),
    endsAt,
    closed: false,
    timeout: null,
  };
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

async function handlePollButton(interaction, client) {
  if (interaction.customId === POLL_PANEL_BUTTON_ID) {
    await interaction.showModal(buildPollCreateModal());
    return true;
  }

  if (!interaction.customId.startsWith(POLL_BUTTON_PREFIX)) {
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

  const selectedOptionId = interaction.customId.slice(POLL_BUTTON_PREFIX.length);
  const selectedOption = poll.options.find((option) => option.id === selectedOptionId);

  if (!selectedOption) {
    await interaction.reply({
      content: 'Odabrana opcija nije prepoznata.',
      ephemeral: true,
    });
    return true;
  }

  const previousVote = poll.votes.get(interaction.user.id);
  poll.votes.set(interaction.user.id, selectedOption.id);

  await interaction.update({
    embeds: [buildPollEmbed(poll)],
    components: [buildPollButtons(poll)],
  });

  await interaction.followUp({
    content:
      previousVote && previousVote !== selectedOption.id
        ? `Tvoj glas je prebacen na **${selectedOption.label}**.`
        : previousVote === selectedOption.id
          ? `Tvoj glas za **${selectedOption.label}** je vec zabiljezen.`
          : `Tvoj glas za **${selectedOption.label}** je uspjesno zabiljezen.`,
    ephemeral: true,
  });

  return true;
}

async function handlePollModal(interaction, client) {
  if (!interaction.isModalSubmit() || interaction.customId !== POLL_CREATE_MODAL_ID) {
    return false;
  }

  const poll = buildPollFromModal(interaction);

  if (!poll) {
    await interaction.reply({
      content: 'Opcije ankete moraju biti razlicite. Promijeni nazive i pokusaj ponovno.',
      ephemeral: true,
    });
    return true;
  }

  const pollMessage = await interaction.channel.send({
    embeds: [buildPollEmbed(poll)],
    components: [buildPollButtons(poll)],
  });

  poll.messageId = pollMessage.id;
  poll.channelId = interaction.channelId;
  poll.guildId = interaction.guildId;
  poll.createdBy = interaction.user.id;

  activePolls.set(pollMessage.id, poll);
  schedulePollEnd(client, poll);

  await interaction.reply({
    content: `Anketa **${poll.title}** je uspjesno kreirana i traje 24 sata.`,
    ephemeral: true,
  });

  return true;
}

module.exports = {
  handlePollButton,
  handlePollModal,
  postPollPanel,
};
