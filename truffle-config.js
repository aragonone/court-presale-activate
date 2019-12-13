const TruffleConfig = require('@aragon/truffle-config-v5/truffle-config')

const gasLimit = 10e6

TruffleConfig.compilers.solc.version = '0.5.8'
TruffleConfig.networks.rpc.gas = gasLimit

module.exports = TruffleConfig
