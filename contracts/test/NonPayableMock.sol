pragma solidity ^0.5.8;


contract NonPayableMock {
    function () external payable {
        revert();
    }
}
