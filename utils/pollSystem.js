const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const POLL_PANEL_CHANNEL_ID = '1485686826558816296';
const POLL_PANEL_BUTTON_ID = 'poll_panel_create';
const POLL_CREATE_STEP_ONE_MODAL_ID = 'poll_create_step_one';
const POLL_CREATE_STEP_TWO_MODAL_ID = 'poll_create_step_two';
const POLL_CONTINUE_BUTTON_PREFIX = 'poll_continue_setup:';
const POLL_BUTTON_PREFIX = 'anketa_vote:';

const activePolls = new Map();
const pendingPollDrafts = new Map();

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

function buildPollStepOneModal() {
  return new ModalBuilder()
    .setCustomId(POLL_CREATE_STEP_ONE_MODAL_ID)
    .setTitle('Kreiranje ankete - 1/2')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_title')
          .setLabel('Naslov ankete')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder('npr. Koju mapu vozimo ovaj vikend?')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_description')
          .setLabel('Opis ankete')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(300)
          .setPlaceholder('Kratko objasni sta se bira i zasto glasate.')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_duration')
          .setLabel('Trajanje ankete')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(20)
          .setPlaceholder('npr. 30m, 6h, 2d')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_option_1_title')
          .setLabel('Naslov opcije 1')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder('npr. Balkanska Dolina')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_option_1_description')
          .setLabel('Opis opcije 1')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(200)
          .setPlaceholder('npr. Mala polja, brda i roleplay gameplay.')
      )
    );
}

function buildPollStepTwoModal() {
  return new ModalBuilder()
    .setCustomId(POLL_CREATE_STEP_TWO_MODAL_ID)
    .setTitle('Kreiranje ankete - 2/2')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_option_2_title')
          .setLabel('Naslov opcije 2')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder('npr. Midwest USA')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_option_2_description')
          .setLabel('Opis opcije 2')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(200)
          .setPlaceholder('npr. Velika ravna polja i velike masine.')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_option_3_title')
          .setLabel('Naslov opcije 3 (opcionalno)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setPlaceholder('npr. Elmcreek')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('poll_option_3_description')
          .setLabel('Opis opcije 3 (opcionalno)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(200)
          .setPlaceholder('npr. Balansirana mapa za manju ekipu.')
      )
    );
}

function buildContinueSetupRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${POLL_CONTINUE_BUTTON_PREFIX}${userId}`)
      .setLabel('Nastavi unos')
      .setStyle(ButtonStyle.Primary)
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

function parsePollDuration(rawValue) {
  const value = rawValue.trim().toLowerCase();
  const match = value.match(/^(\d+)\s*([mhd])$/);

  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];

  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  const unitMs = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }[unit];

  const durationMs = amount * unitMs;
  const minDurationMs = 5 * 60 * 1000;
  const maxDurationMs = 14 * 24 * 60 * 60 * 1000;

  if (durationMs < minDurationMs || durationMs > maxDurationMs) {
    return null;
  }

  return durationMs;
}

function formatDurationLabel(durationMs) {
  if (durationMs % (24 * 60 * 60 * 1000) === 0) {
    return `${durationMs / (24 * 60 * 60 * 1000)}d`;
  }

  if (durationMs % (60 * 60 * 1000) === 0) {
    return `${durationMs / (60 * 60 * 1000)}h`;
  }

  return `${durationMs / (60 * 1000)}m`;
}

function normalizeOption(option, index) {
  return {
    id: `option_${index + 1}`,
    label: option.label,
    description: option.description,
    style: buildButtonStyle(index),
  };
}

function hasDuplicateOptionTitles(options) {
  const labels = options.map((option) => option.label.trim().toLowerCase());
  return new Set(labels).size !== labels.length;
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
          : `Glasanje traje do ${formatDiscordRelativeTime(poll.endsAt)}.`,
      ].join('\n\n')
    )
    .addFields(
      ...poll.options.map((option) => ({
        name: option.label,
        value: `${option.description}\n\nGlasova: **${totals[option.id]}**`,
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
      text: `Ukupno glasova: ${totalVotes} | Trajanje: ${formatDurationLabel(poll.durationMs)} | Jedan korisnik moze imati samo jedan aktivan glas`,
    })
    .setTimestamp();
}

function buildStepOneDraft(interaction) {
  const durationMs = parsePollDuration(
    interaction.fields.getTextInputValue('poll_duration')
  );

  if (!durationMs) {
    return { error: 'Trajanje mora biti izmedu 5m i 14d. Primjeri: 30m, 6h, 2d.' };
  }

  return {
    title: interaction.fields.getTextInputValue('poll_title').trim(),
    description: interaction.fields.getTextInputValue('poll_description').trim(),
    durationMs,
    options: [
      {
        label: interaction.fields.getTextInputValue('poll_option_1_title').trim(),
        description: interaction.fields
          .getTextInputValue('poll_option_1_description')
          .trim(),
      },
    ],
  };
}

function buildPollFromDraft(draft, interaction) {
  const optionTwoTitle = interaction.fields.getTextInputValue('poll_option_2_title').trim();
  const optionTwoDescription = interaction.fields
    .getTextInputValue('poll_option_2_description')
    .trim();
  const optionThreeTitle = interaction.fields.getTextInputValue('poll_option_3_title').trim();
  const optionThreeDescription = interaction.fields
    .getTextInputValue('poll_option_3_description')
    .trim();

  const options = [
    ...draft.options,
    {
      label: optionTwoTitle,
      description: optionTwoDescription,
    },
  ];

  if (optionThreeTitle || optionThreeDescription) {
    if (!optionThreeTitle || !optionThreeDescription) {
      return {
        error: 'Ako koristis opciju 3, moras upisati i naslov i opis.',
      };
    }

    options.push({
      label: optionThreeTitle,
      description: optionThreeDescription,
    });
  }

  if (hasDuplicateOptionTitles(options)) {
    return {
      error: 'Nazivi opcija moraju biti razliciti. Promijeni duplikate i pokusaj ponovno.',
    };
  }

  const endsAt = Date.now() + draft.durationMs;

  return {
    title: draft.title,
    description: draft.description,
    durationMs: draft.durationMs,
    options: options.map(normalizeOption),
    votes: new Map(),
    endsAt,
    closed: false,
    timeout: null,
  };
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

async function safeShowPollModal(interaction, modalBuilder) {
  try {
    await interaction.showModal(modalBuilder);
    return true;
  } catch (error) {
    if (error?.code === 10062) {
      console.error('ANKETA MODAL ERROR: interaction expired before modal could open.');

      const channel = interaction.channel;
      if (channel?.isTextBased()) {
        await channel.send({
          content: `<@${interaction.user.id}> klik je istekao prije otvaranja forme. Klikni ponovo na **Kreiraj anketu**.`,
        }).catch(() => {});
      }

      return true;
    }

    throw error;
  }
}

async function handlePollButton(interaction, client) {
  if (interaction.customId === POLL_PANEL_BUTTON_ID) {
    await safeShowPollModal(interaction, buildPollStepOneModal());
    return true;
  }

  if (interaction.customId.startsWith(POLL_CONTINUE_BUTTON_PREFIX)) {
    const ownerId = interaction.customId.slice(POLL_CONTINUE_BUTTON_PREFIX.length);

    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: 'Samo korisnik koji je zapoceo unos moze nastaviti ovu anketu.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const draft = pendingPollDrafts.get(interaction.user.id);
    if (!draft) {
      await interaction.reply({
        content: 'Prvi korak je istekao. Klikni ponovo na **Kreiraj anketu**.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await safeShowPollModal(interaction, buildPollStepTwoModal());
    return true;
  }

  if (!interaction.customId.startsWith(POLL_BUTTON_PREFIX)) {
    return false;
  }

  const poll = activePolls.get(interaction.message.id);
  if (!poll) {
    await interaction.reply({
      content: 'Ova anketa vise nije aktivna ili je restart bota ocistio stanje iz memorije.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (poll.closed || Date.now() >= poll.endsAt) {
    await finalizePoll(client, poll.messageId);
    await interaction.reply({
      content: 'Anketa je zavrsena. Dugmad su iskljucena, a finalni rezultati su ostali prikazani.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const selectedOptionId = interaction.customId.slice(POLL_BUTTON_PREFIX.length);
  const selectedOption = poll.options.find((option) => option.id === selectedOptionId);

  if (!selectedOption) {
    await interaction.reply({
      content: 'Odabrana opcija nije prepoznata.',
      flags: MessageFlags.Ephemeral,
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
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

async function handlePollModal(interaction, client) {
  if (!interaction.isModalSubmit()) {
    return false;
  }

  if (interaction.customId === POLL_CREATE_STEP_ONE_MODAL_ID) {
    const draft = buildStepOneDraft(interaction);

    if (draft.error) {
      await interaction.reply({
        content: draft.error,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    pendingPollDrafts.set(interaction.user.id, {
      ...draft,
      channelId: interaction.channelId,
      createdAt: Date.now(),
    });

    await interaction.reply({
      content:
        'Prvi korak je spremljen. Klikni na dugme ispod za unos ostalih opcija i zavrsetak ankete.',
      components: [buildContinueSetupRow(interaction.user.id)],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId !== POLL_CREATE_STEP_TWO_MODAL_ID) {
    return false;
  }

  const draft = pendingPollDrafts.get(interaction.user.id);
  if (!draft) {
    await interaction.reply({
      content: 'Prvi korak nije pronaden ili je istekao. Pokreni kreiranje ankete ponovo.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const poll = buildPollFromDraft(draft, interaction);
  if (poll.error) {
    await interaction.reply({
      content: poll.error,
      flags: MessageFlags.Ephemeral,
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
  pendingPollDrafts.delete(interaction.user.id);
  schedulePollEnd(client, poll);

  await interaction.reply({
    content: `Anketa **${poll.title}** je uspjesno kreirana i traje ${formatDurationLabel(poll.durationMs)}.`,
    flags: MessageFlags.Ephemeral,
  });

  return true;
}

module.exports = {
  handlePollButton,
  handlePollModal,
  postPollPanel,
};
