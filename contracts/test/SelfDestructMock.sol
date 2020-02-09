pragma solidity ^0.5.8;


contract SelfDestructMock {
    event FundsReceived(address sender, uint256 amount);

    function selfDestruct(address payable _recipient) external {
        selfdestruct(_recipient);
    }

    function() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }
}
