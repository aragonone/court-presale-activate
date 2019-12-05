pragma solidity ^0.5.8;

import "@aragon/court/contracts/registry/JurorsRegistry.sol";


// HACK to workaround truffle artifact loading on dependencies
contract TestImports {
    constructor() public {
        // to avoid lint error
    }
}
