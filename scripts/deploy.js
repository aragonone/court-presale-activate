const CPA = artifacts.require('CourtPresaleActivate')

module.exports = async () => {

  if (process.argv.length != 6) {
    console.error('Usage: truffle exec scripts/deploy.js --network <network-name>')
    process.exit(1)
  }

  try {
    const network = process.argv[process.argv.length - 1]
    const { bondedToken, registry, presale } = require('./config')[network]

    const cpa = await CPA.new(bondedToken, registry, presale)

    console.log(`Deployed Court Presale Buy and Activate Wrapper at ${cpa.address}`)
  } catch (error) {
    console.error(error)
  }
  process.exit(0)
}

