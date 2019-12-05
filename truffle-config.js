const TruffleConfig = require('@aragon/truffle-config-v5/truffle-config')

const gasLimit = 10e6

TruffleConfig.compilers.solc.version = '0.5.8'
//TruffleConfig.compilers.solc.settings.optimizer.runs = 5000 // DisputesManager module is hitting size limit with 10k runs
TruffleConfig.networks.rpc.gas = gasLimit

module.exports = TruffleConfig
