import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Document, Packer, Paragraph } from 'docx'

const doc = new Document({
  sections: [
    {
      children: [
        new Paragraph('The project codename is Tangerine Falcon.'),
        new Paragraph('The kickoff meeting is held every Monday morning.'),
      ],
    },
  ],
})

writeFileSync(fileURLToPath(new URL('./notes.docx', import.meta.url)), await Packer.toBuffer(doc))
