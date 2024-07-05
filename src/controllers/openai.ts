import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generateAppFormDescriptions = async (appDetails: {
  name: string;
  category: string;
  audience: string;
  purpose: string;
}) => {
  const { name, category, audience, purpose } = appDetails;
  const features =
    "Courses, Community Feed, Workshops, Message Rooms, and a lot more";

  const prompts = [
    {
      type: "androidStoreSettings.short_description",
      prompt: `Generate a short description for the Android Play Store for an app with the following details:\n\nApp Name: ${name}\nApp Category: ${category}\nTarget Audience: ${audience}\nPurpose: ${purpose}\nKey Features: ${features}\n\nShort Description (max 80 characters):`,
    },
    {
      type: "androidStoreSettings.full_description",
      prompt: `Generate a long description for the Android Play Store for an app with the following details:\n\nApp Name: ${name}\nApp Category: ${category}\nTarget Audience: ${audience}\nPurpose: ${purpose}\nKey Features: ${features}\n\nLong Description (max 4000 characters):`,
    },
    {
      type: "iosStoreSettings.promotional_text",
      prompt: `Generate a promotional text for the iOS App Store for an app with the following details:\n\nApp Name: ${name}\nApp Category: ${category}\nTarget Audience: ${audience}\nPurpose: ${purpose}\nKey Features: ${features}\n\nPromotional Text (max 170 characters):`,
    },
    {
      type: "iosStoreSettings.description",
      prompt: `Generate a description for the iOS App Store for an app with the following details:\n\nApp Name: ${name}\nApp Category: ${category}\nTarget Audience: ${audience}\nPurpose: ${purpose}\nKey Features: ${features}\n\nDescription (max 4000 characters):`,
    },
    {
      type: "iosStoreSettings.keywords",
      prompt: `Generate comma separated keywords for the iOS App Store for an app with the following details:\n\nApp Name: ${name}\nApp Category: ${category}\nTarget Audience: ${audience}\nPurpose: ${purpose}\nKey Features: ${features}\n\nComma Separated Keywords (max 100 characters):`,
    },
  ];

  const generateText = async (prompt: (typeof prompts)[number]) => {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt.prompt }],
    });
    return { type: prompt.type, text: response.choices[0].message.content };
  };

  const results = await Promise.all(prompts.map(generateText));
  return results;
};

export { generateAppFormDescriptions };
